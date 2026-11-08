/** Pure grayscale-buffer estimator: no System.Drawing dependency. C# 5 only. */
export const ESTIMATOR_SOURCE = String.raw`
using System;
using System.Collections.Generic;
namespace ScanDeskew {
    public static class Estimator {
        private struct Point {
            public int X, Y;
            public Point(int x, int y) { X = x; Y = y; }
        }
        public static Estimate Analyze(byte[] gray, int width, int height, int stride) {
            return Analyze(gray, width, height, stride, false);
        }
        public static Estimate Analyze(byte[] gray, int width, int height, int stride, bool diagnostics) {
            Estimate result = new Estimate(false, 0);
            Note(result, diagnostics, "size={0}x{1} stride={2} min={3} max={4} border={5}", width, height, stride, Limits.MinDimension, Limits.LongEdge, Limits.Border);
            if (gray == null || width < Limits.MinDimension || height < Limits.MinDimension ||
                width > Limits.LongEdge || height > Limits.LongEdge || stride < width ||
                (long)stride * height > gray.Length) return Reject(result, "dimensions");
            int left = (int)(width * Limits.Border), top = (int)(height * Limits.Border);
            int right = width - left, bottom = height - top;
            long edgeSum = 0; int edgeCount = 0;
            for (int y = 0; y < height; y++) for (int x = 0; x < width; x++) {
                if (x < left || x >= right || y < top || y >= bottom) {
                    edgeSum += gray[y * stride + x]; edgeCount++;
                }
            }
            double background = (double)edgeSum / edgeCount;
            Note(result, diagnostics, "background={0:F4} min={1} contrast={2}", background, Limits.MinBackground, Limits.InkContrast);
            if (background < Limits.MinBackground) return Reject(result, "background");
            bool[] ink = new bool[width * height]; int count = 0;
            for (int y = top; y < bottom; y++) for (int x = left; x < right; x++) {
                if (gray[y * stride + x] < background - Limits.InkContrast) {
                    ink[y * width + x] = true; count++;
                }
            }
            double fraction = (double)count / ((right - left) * (bottom - top));
            Note(result, diagnostics, "ink={0:F6} range=[{1},{2}] roi=[{3},{4},{5},{6}]", fraction, Limits.MinInk, Limits.MaxInk, left, top, right, bottom);
            if (fraction < Limits.MinInk || fraction > Limits.MaxInk) return Reject(result, "foreground_fraction");
            List<Point> points = new List<Point>(); int glyphs = 0;
            int[] queue = new int[count];
            for (int y = top; y < bottom; y++) for (int x = left; x < right; x++) {
                int first = y * width + x;
                if (!ink[first]) continue;
                int head = 0, tail = 1, minX = x, maxX = x, minY = y, maxY = y;
                queue[0] = first; ink[first] = false;
                while (head < tail) {
                    int p = queue[head++], px = p % width, py = p / width;
                    minX = Math.Min(minX, px); maxX = Math.Max(maxX, px);
                    minY = Math.Min(minY, py); maxY = Math.Max(maxY, py);
                    for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
                        int nx = px + dx, ny = py + dy;
                        if (nx < left || nx >= right || ny < top || ny >= bottom) continue;
                        int n = ny * width + nx;
                        if (ink[n]) { ink[n] = false; queue[tail++] = n; }
                    }
                }
                int w = maxX - minX + 1, h = maxY - minY + 1;
                // Lines / large objects make the whole page uncertain, even after filtering.
                if (w >= (right - left) * Limits.MaxLineWidth || h >= (bottom - top) * Limits.MaxLineHeight) {
                    Note(result, diagnostics, "component={0}x{1} lineLimits={2:F2}x{3:F2}", w, h, (right - left) * Limits.MaxLineWidth, (bottom - top) * Limits.MaxLineHeight);
                    return Reject(result, "large_component");
                }
                double ratio = (double)w / h;
                if (tail < Limits.MinGlyphArea || w > width * Limits.MaxGlyphWidth ||
                    h > height * Limits.MaxGlyphHeight || tail > width * height * Limits.MaxGlyphArea ||
                    ratio < Limits.MinGlyphRatio || ratio > Limits.MaxGlyphRatio) continue;
                glyphs++;
                for (int i = 0; i < tail; i++) points.Add(new Point(queue[i] % width, queue[i] / width));
            }
            Note(result, diagnostics, "glyphs={0} min={1} keptInk={2:F6} min={3}", glyphs, Limits.MinGlyphs, (double)points.Count / count, Limits.MinKeptInk);
            if (glyphs < Limits.MinGlyphs) return Reject(result, "glyph_count");
            if (points.Count < count * Limits.MinKeptInk) return Reject(result, "kept_ink");
            double angle = Search(points, height, width);
            double best = Score(points, angle, height, width), zero = Score(points, 0, height, width), second = 0;
            for (double a = -Limits.MaxAngle; a <= Limits.MaxAngle + 0.00001; a += Limits.FineStep)
                if (Math.Abs(a - angle) >= Limits.PeakDistance - 0.00001)
                    second = Math.Max(second, Score(points, a, height, width));
            result.AngleDeg = angle;
            Note(result, diagnostics, "angle={0:F4} absMin={1} boundaryRoom={2:F4} min={3} best={4:G8} zero={5:G8} second={6:G8} zeroGain={7:F6} min={8} peakGain={9:F6} min={10}",
                angle, Limits.MinAngle, Limits.MaxAngle - Math.Abs(angle), Limits.BoundaryMargin, best, zero, second,
                zero > 0 ? best / zero - 1 : Double.NaN, Limits.ZeroGain, second > 0 ? best / second - 1 : Double.NaN, Limits.PeakGain);
            if (Math.Abs(angle) < Limits.MinAngle - 0.00001) return Reject(result, "absolute_angle");
            if (Math.Abs(angle) > Limits.MaxAngle - Limits.BoundaryMargin + 0.00001) return Reject(result, "boundary_margin");
            if (!Finite(best) || best <= 0) return Reject(result, "invalid_score");
            if (best < zero * (1 + Limits.ZeroGain)) return Reject(result, "zero_gain");
            if (best < second * (1 + Limits.PeakGain)) return Reject(result, "peak_gain");
            List<Point> upper = points.FindAll(delegate(Point p) { return p.Y < height / 2; });
            List<Point> lower = points.FindAll(delegate(Point p) { return p.Y >= height / 2; });
            Note(result, diagnostics, "halfPoints={0}/{1}", upper.Count, lower.Count);
            if (upper.Count == 0 || lower.Count == 0) return Reject(result, "empty_half");
            double upperAngle = Search(upper, height, width), lowerAngle = Search(lower, height, width);
            Note(result, diagnostics, "halfAngles={0:F4}/{1:F4} delta={2:F4} max={3}", upperAngle, lowerAngle, Math.Abs(upperAngle - lowerAngle), Limits.HalfAgreement);
            if (Math.Abs(upperAngle - lowerAngle) > Limits.HalfAgreement + 0.00001) return Reject(result, "half_agreement");
            List<List<Point>> bands = Bands(points, angle, width, height, result, diagnostics);
            Note(result, diagnostics, "bands={0} min={1}", bands.Count, Limits.MinBands);
            if (bands.Count < Limits.MinBands) return Reject(result, "band_count_or_width");
            for (int i = 0; i < Limits.MinBands; i++) {
                List<Point> band = bands[i * (bands.Count - 1) / (Limits.MinBands - 1)];
                double bandAngle = Search(band, height, width);
                Note(result, diagnostics, "band[{0}]angle={1:F4} delta={2:F4} max={3}", i, bandAngle, Math.Abs(bandAngle - angle), Limits.BandAgreement);
                if (Math.Abs(bandAngle - angle) > Limits.BandAgreement + 0.00001) return Reject(result, "band_agreement");
            }
            result.Corrected = true; result.Reason = "accepted";
            return result;
        }
        private static Estimate Reject(Estimate result, string reason) { result.Reason = reason; return result; }
        private static void Note(Estimate result, bool diagnostics, string format, params object[] values) {
            if (diagnostics) result.Detail += " " + String.Format(System.Globalization.CultureInfo.InvariantCulture, format, values);
        }
        private static bool Finite(double v) { return !Double.IsNaN(v) && !Double.IsInfinity(v); }
        private static double Search(List<Point> points, int height, int width) {
            double peak = -1, angle = 0;
            for (double a = -Limits.MaxAngle; a <= Limits.MaxAngle + 0.00001; a += Limits.CoarseStep) {
                double s = Score(points, a, height, width);
                if (s > peak) { peak = s; angle = a; }
            }
            double coarse = angle;
            for (double a = Math.Max(-Limits.MaxAngle, coarse - Limits.CoarseStep);
                a <= Math.Min(Limits.MaxAngle, coarse + Limits.CoarseStep) + 0.00001; a += Limits.FineStep) {
                double s = Score(points, a, height, width);
                if (s > peak) { peak = s; angle = a; }
            }
            return Math.Round(angle, 4);
        }
        private static double Score(List<Point> points, double angle, int height, int width) {
            if (points.Count == 0) return 0;
            double[] rows = new double[height * 2]; double slope = Math.Tan(angle * Math.PI / 180);
            foreach (Point p in points) {
                double row = p.Y - slope * (p.X - width / 2.0) + height / 2.0;
                int r = (int)Math.Floor(row); double part = row - r;
                if (r < 0 || r + 1 >= rows.Length) continue;
                rows[r] += 1 - part; rows[r + 1] += part;
            }
            double sum = 0;
            foreach (double v in rows) sum += v * v;
            return sum / ((double)points.Count * points.Count) - 1.0 / rows.Length;
        }
        private static List<List<Point>> Bands(List<Point> points, double angle, int width, int height, Estimate result, bool diagnostics) {
            int[] rows = new int[height * 2]; double slope = Math.Tan(angle * Math.PI / 180);
            foreach (Point p in points) rows[(int)(p.Y - slope * (p.X - width / 2.0) + height / 2.0)]++;
            List<List<Point>> bands = new List<List<Point>>(); int start = -1, last = -1;
            for (int y = 0; y <= rows.Length; y++) {
                if (y < rows.Length && rows[y] >= width * Limits.MinRowInk) {
                    if (start < 0) start = y;
                    last = y;
                }
                if (start < 0 || (y < rows.Length && y - last <= Limits.BandGap)) continue;
                int from = start, to = last;
                List<Point> band = points.FindAll(delegate(Point p) {
                    double row = p.Y - slope * (p.X - width / 2.0) + height / 2.0;
                    return row >= from && row < to + 1;
                });
                int minX = width, maxX = 0;
                foreach (Point p in band) { minX = Math.Min(minX, p.X); maxX = Math.Max(maxX, p.X); }
                Note(result, diagnostics, "bandCandidate[y={0}..{1}]height={2} min={3} width={4} min={5:F2}", from, to, to - from + 1, Limits.MinBandHeight, maxX - minX, width * (1 - 2 * Limits.Border) * Limits.MinBandWidth);
                if (to - from + 1 >= Limits.MinBandHeight && maxX - minX >= width * (1 - 2 * Limits.Border) * Limits.MinBandWidth)
                    bands.Add(band);
                start = -1;
            }
            return bands;
        }
    }
}
`;
