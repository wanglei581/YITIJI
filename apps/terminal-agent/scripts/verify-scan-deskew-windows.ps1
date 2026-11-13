# Windows PowerShell 5.1 + .NET Framework System.Drawing. Synthetic only; no device.
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5) { throw 'Requires Windows PowerShell 5.1' }
$sourceRoot = Join-Path $PSScriptRoot '..\src\agent\scan-deskew'
function Read-CSharp([string]$name) {
    $text = Get-Content -LiteralPath (Join-Path $sourceRoot $name) -Raw -Encoding UTF8
    $match = [regex]::Match($text, '(?s)String\.raw`\r?\n(.*)\r?\n`;')
    if (-not $match.Success) { throw "Missing C# source: $name" }
    return $match.Groups[1].Value
}
$limits = Read-CSharp 'thresholds-source.ts'
$estimator = Read-CSharp 'estimator-source.ts'
$image = Read-CSharp 'image-source.ts'
# Same compilation unit as script.ts. Move estimator imports before all namespaces.
$source = $image.Replace('using System;', "using System;`nusing System.Collections.Generic;") +
    [regex]::Replace($estimator, '(?m)^using .*;\r?$', '') + $limits
$tests = @'
namespace ScanDeskew {
    public static class SyntheticGate {
        private static int failures = 0;
        private static List<string> sampleErrors;
        private static bool IsText(string kind) { return kind == "text" || kind == "text2x"; }
        private static void Record(string kind, double angle, string format, Estimate result, int[] totals, bool eligible, bool mustStay) {
            totals[0]++; if (eligible) totals[1]++; if (eligible && result.Corrected) totals[2]++;
            if (result.Corrected) totals[3]++;
            bool wrongAngle = result.Corrected && Math.Abs(result.AngleDeg - angle) > Limits.HalfAgreement;
            if (result.Corrected && (mustStay || wrongAngle)) totals[4]++;
            bool failed = sampleErrors.Count > 0;
            if (failed) { failures++; totals[5]++; }
            Console.WriteLine((failed ? "FAIL" : "PASS") + " synthetic name=" + kind + " inputAngle=" + angle.ToString(System.Globalization.CultureInfo.InvariantCulture) +
                " format=" + format + " corrected=" + result.Corrected + " estimated=" + result.AngleDeg.ToString("F4", System.Globalization.CultureInfo.InvariantCulture) +
                " reason=" + result.Reason + " diagnostics=" + result.Detail + " checks=" + (failed ? String.Join(";", sampleErrors.ToArray()) : "ok"));
        }
        private static void Require(bool condition, string message) {
            if (!condition) sampleErrors.Add(message);
        }
        private static Bitmap Page(string kind) {
            int scale = kind == "text2x" ? 2 : 1;
            Bitmap page = new Bitmap(900 * scale, 1200 * scale, PixelFormat.Format24bppRgb);
            page.SetResolution((float)Limits.DefaultDpi, (float)Limits.DefaultDpi);
            using (Graphics g = Graphics.FromImage(page)) {
                g.Clear(Color.White);
                g.ScaleTransform(scale, scale);
                using (Font latin = new Font("Arial", 13, FontStyle.Regular, GraphicsUnit.Pixel))
                using (Font chinese = new Font("SimSun", 13, FontStyle.Regular, GraphicsUnit.Pixel)) {
                    if (kind != "blank" && kind != "photo" && kind != "id") {
                        for (int row = 0; row < 15; row++) {
                            string text = row % 2 == 0 ? "Application resume skills experience education 0123456789 ABCDEFGHIJKLMNOP" :
                                "\u5de5\u4f5c\u7ecf\u5386 \u6559\u80b2\u80cc\u666f \u4e13\u4e1a\u6280\u80fd \u6c42\u804c\u6750\u6599 \u5de5\u4f5c\u7ecf\u5386 \u6559\u80b2\u80cc\u666f \u4e13\u4e1a\u6280\u80fd \u6c42\u804c\u6750\u6599";
                            g.DrawString(text, row % 2 == 0 ? latin : chinese, row % 2 == 0 ? Brushes.Black : Brushes.Navy, 100, 100 + row * 65);
                        }
                    }
                    if (kind == "table" || kind == "invoice") {
                        for (int y = 80; y <= 1080; y += 100) g.DrawLine(Pens.Black, 80, y, 820, y);
                        for (int x = 80; x <= 820; x += 148) g.DrawLine(Pens.Black, x, 80, x, 1080);
                    }
                }
            }
            Random random = new Random(1104);
            if (kind == "photo" || kind == "id") {
                for (int y = 60; y < 1140; y++) for (int x = 60; x < 840; x++) {
                    int value = kind == "photo" ? random.Next(256) : ((x + y) % 7 < 3 ? 80 : 240);
                    page.SetPixel(x, y, Color.FromArgb(value, value, value));
                }
            }
            return page;
        }
        private static Bitmap Skew(Bitmap page, double angle, bool legacyPhysicalSize) {
            Bitmap sample = new Bitmap(page.Width, page.Height, PixelFormat.Format24bppRgb);
            // A 300 DPI source drawn into an implicit-DPI bitmap with DrawImageUnscaled
            // is rendered at its physical size, not necessarily its pixel dimensions.
            if (!legacyPhysicalSize) sample.SetResolution(page.HorizontalResolution, page.VerticalResolution);
            using (Graphics g = Graphics.FromImage(sample)) {
                g.Clear(Color.White);
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.TranslateTransform(sample.Width / 2f, sample.Height / 2f);
                g.RotateTransform((float)angle);
                g.TranslateTransform(-page.Width / 2f, -page.Height / 2f);
                if (legacyPhysicalSize) g.DrawImageUnscaled(page, 0, 0);
                else g.DrawImage(page, new Rectangle(0, 0, page.Width, page.Height), 0, 0, page.Width, page.Height, GraphicsUnit.Pixel);
            }
            return sample;
        }
        private static byte[] Gray(Bitmap page, int stride) {
            byte[] gray = new byte[stride * page.Height];
            BitmapData data = page.LockBits(new Rectangle(0, 0, page.Width, page.Height), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
            try {
                byte[] row = new byte[page.Width * 3];
                for (int y = 0; y < page.Height; y++) {
                    Marshal.Copy(IntPtr.Add(data.Scan0, y * data.Stride), row, 0, row.Length);
                    for (int x = 0; x < page.Width; x++) gray[y * stride + x] = (byte)((row[x * 3] * 114 + row[x * 3 + 1] * 587 + row[x * 3 + 2] * 299) / 1000);
                }
            } finally { page.UnlockBits(data); }
            return gray;
        }
        private static void Save(Bitmap sample, string input, string format) {
            if (format == "bmp8") {
                using (Bitmap indexed = new Bitmap(sample.Width, sample.Height, PixelFormat.Format8bppIndexed)) {
                    ColorPalette palette = indexed.Palette;
                    for (int i = 0; i < 256; i++) palette.Entries[i] = Color.FromArgb(i, i, i);
                    indexed.Palette = palette;
                    BitmapData data = indexed.LockBits(new Rectangle(0, 0, indexed.Width, indexed.Height), ImageLockMode.WriteOnly, PixelFormat.Format8bppIndexed);
                    try {
                        byte[] bytes = Gray(sample, Math.Abs(data.Stride));
                        for (int y = 0; y < indexed.Height; y++) Marshal.Copy(bytes, y * Math.Abs(data.Stride), IntPtr.Add(data.Scan0, y * data.Stride), indexed.Width);
                    } finally { indexed.UnlockBits(data); }
                    indexed.Save(input, ImageFormat.Bmp);
                }
            } else sample.Save(input, format == "png" ? ImageFormat.Png : format == "jpeg" ? ImageFormat.Jpeg : ImageFormat.Bmp);
        }
        private static void Corners(string output) {
            using (Bitmap image = new Bitmap(output)) {
                int[] xs = new int[] { 0, image.Width - 1 }, ys = new int[] { 0, image.Height - 1 };
                foreach (int x in xs) foreach (int y in ys) {
                    Color c = image.GetPixel(x, y);
                    Require(Math.Min(c.R, Math.Min(c.G, c.B)) >= Limits.MinBackground, "new black corner");
                }
            }
        }
        private static Point[] MarkerPoints(Bitmap sample) {
            return new Point[] { new Point(8, 8), new Point(sample.Width - 9, 8),
                new Point(8, sample.Height - 9), new Point(sample.Width - 9, sample.Height - 9),
                new Point(sample.Width / 2, 8), new Point(sample.Width / 2, sample.Height - 9),
                new Point(8, sample.Height / 2), new Point(sample.Width - 9, sample.Height / 2) };
        }
        private static void Mark(Bitmap sample) {
            using (Graphics g = Graphics.FromImage(sample)) foreach (Point p in MarkerPoints(sample))
                g.FillRectangle(Brushes.Magenta, p.X - 3, p.Y - 3, 7, 7);
        }
        private const int MarkerTolerance = 20;
        private static Color ExpectedMarker(string format) {
            // Save(bmp8) applies Gray, then an identity grayscale palette: magenta becomes 105.
            // Do not derive this expectation from decoded pixels: missing input marks must fail too.
            int gray = (255 * 114 + 255 * 299) / 1000;
            return format == "bmp8" ? Color.FromArgb(gray, gray, gray) : Color.Magenta;
        }
        private static bool MatchesMarker(Color c, Color expected) {
            if (expected.R != expected.G) return c.R > 150 && c.B > 150 && c.G < 120;
            return Math.Abs(c.R - expected.R) <= MarkerTolerance && Math.Abs(c.G - expected.G) <= MarkerTolerance &&
                Math.Abs(c.B - expected.B) <= MarkerTolerance;
        }
        private static string Rgb(Color c) { return c.R + "," + c.G + "," + c.B; }
        private static void InputMarkers(Bitmap sample, Bitmap decoded, string format) {
            Require(decoded.Width == sample.Width && decoded.Height == sample.Height, "encoded input dimensions");
            Color expected = ExpectedMarker(format);
            foreach (Point p in MarkerPoints(sample)) {
                Color before = sample.GetPixel(p.X, p.Y), after = decoded.GetPixel(p.X, p.Y);
                Require(before.ToArgb() == Color.Magenta.ToArgb(), "missing fixture marker before encoding");
                Require(MatchesMarker(after, expected), "lost encoded input corner/edge marker at " + p);
                if (format == "bmp8") {
                    Require(after.ToArgb() == expected.ToArgb(), "bmp8 palette/gray mismatch at " + p);
                    Console.WriteLine("PROBE marker-input format=" + format + " point=" + p + " sourceRGB=" + Rgb(before) +
                        " decodedRGB=" + Rgb(after) + " expectedRGB=" + Rgb(expected) + " pixelFormat=" + decoded.PixelFormat +
                        " palette105RGB=" + Rgb(decoded.Palette.Entries[105]) + " legacyMagentaMatch=" + MatchesMarker(after, Color.Magenta));
                }
            }
        }
        private static bool FindMarker(Bitmap image, int cx, int cy, Color expected, out Color nearest) {
            bool found = false; int distance = Int32.MaxValue; nearest = Color.Empty;
            for (int dy = -4; dy <= 4; dy++) for (int dx = -4; dx <= 4; dx++) {
                if (cx + dx < 0 || cx + dx >= image.Width || cy + dy < 0 || cy + dy >= image.Height) continue;
                Color c = image.GetPixel(cx + dx, cy + dy);
                int d = Math.Abs(c.R - expected.R) + Math.Abs(c.G - expected.G) + Math.Abs(c.B - expected.B);
                if (d < distance) { distance = d; nearest = c; }
                if (MatchesMarker(c, expected)) found = true;
            }
            return found;
        }
        private static void Preserved(Bitmap sample, Bitmap rotated, double angle, string format) {
            double radians = -angle * Math.PI / 180, cos = Math.Cos(radians), sin = Math.Sin(radians);
            Require(rotated.Width == (int)Math.Ceiling(sample.Width * cos + sample.Height * Math.Abs(sin)), "canvas width");
            Require(rotated.Height == (int)Math.Ceiling(sample.Height * cos + sample.Width * Math.Abs(sin)), "canvas height");
            foreach (Point p in MarkerPoints(sample)) {
                double x = p.X - sample.Width / 2.0, y = p.Y - sample.Height / 2.0;
                int cx = (int)Math.Round(cos * x - sin * y + rotated.Width / 2.0);
                int cy = (int)Math.Round(sin * x + cos * y + rotated.Height / 2.0);
                Color nearest, expected = ExpectedMarker(format);
                bool found = FindMarker(rotated, cx, cy, expected, out nearest);
                if (format == "bmp8" || !found) Console.WriteLine("PROBE marker-output format=" + format + " sourcePoint=" + p +
                    " targetPoint=" + cx + "," + cy + " expectedRGB=" + Rgb(expected) + " nearestRGB=" + Rgb(nearest) +
                    " found=" + found + " canvas=" + rotated.Width + "x" + rotated.Height + " pixelFormat=" + rotated.PixelFormat);
                Require(found, "lost original corner/edge marker at " + p);
            }
        }
        private static void ImageChecks(Bitmap sample, string output, Estimate result, string format) {
            Corners(output);
            using (Bitmap rotated = new Bitmap(output)) {
                Require(rotated.Width >= sample.Width && rotated.Height >= sample.Height, "cropped canvas");
                Preserved(sample, rotated, result.AngleDeg, format);
                double scale = Math.Min(1, (double)Limits.LongEdge / Math.Max(rotated.Width, rotated.Height));
                using (Bitmap small = new Bitmap(rotated, (int)(rotated.Width * scale), (int)(rotated.Height * scale))) {
                    Estimate residual = Estimator.Analyze(Gray(small, small.Width), small.Width, small.Height, small.Width, true);
                    // An early rejection with default angle=0 does NOT establish the rotation direction.
                    Require(residual.Reason == "absolute_angle" || residual.Reason == "zero_gain" || residual.Reason == "accepted", "unmeasurable residual: " + residual.Reason);
                    Require(Math.Abs(residual.AngleDeg) <= Limits.HalfAgreement, "rotation residual / wrong sign");
                }
            }
        }
        private static Estimate Pure(Bitmap sample) {
            double scale = Math.Min(1, (double)Limits.LongEdge / Math.Max(sample.Width, sample.Height));
            using (Bitmap small = new Bitmap(sample, (int)(sample.Width * scale), (int)(sample.Height * scale)))
                return Estimator.Analyze(Gray(small, small.Width + 4), small.Width, small.Height, small.Width + 4, true);
        }
        private static void MarkerControls(string directory) {
            sampleErrors = new List<string>();
            try {
                using (Bitmap sample = Page("blank")) {
                    Mark(sample);
                    string input = Path.Combine(directory, "marker-control.bmp");
                    Save(sample, input, "bmp8");
                    using (Bitmap decoded = new Bitmap(input)) {
                        InputMarkers(sample, decoded, "bmp8");
                        Color expected = ExpectedMarker("bmp8"), nearest;
                        Require(!MatchesMarker(expected, Color.Magenta), "legacy checker must reproduce bmp8 false negative");
                        foreach (Color invalid in new Color[] { Color.White, Color.Black, Color.Magenta, Color.FromArgb(150, 150, 150) })
                            Require(!MatchesMarker(invalid, expected), "incorrect gray/palette color accepted");
                        Point[] points = MarkerPoints(sample);
                        for (int erased = 0; erased < points.Length; erased++) {
                            using (Bitmap damaged = new Bitmap(sample.Width, sample.Height, PixelFormat.Format24bppRgb)) {
                                using (Graphics g = Graphics.FromImage(damaged)) {
                                    g.DrawImage(decoded, new Rectangle(0, 0, decoded.Width, decoded.Height), 0, 0, decoded.Width, decoded.Height, GraphicsUnit.Pixel);
                                    Point p = points[erased];
                                    g.FillRectangle(Brushes.White, p.X - 4, p.Y - 4, 9, 9);
                                }
                                for (int i = 0; i < points.Length; i++)
                                    Require(FindMarker(damaged, points[i].X, points[i].Y, expected, out nearest) == (i != erased),
                                        "erased/retained marker control erased=" + erased + " checked=" + i);
                            }
                        }
                    }
                }
            } catch (Exception error) { sampleErrors.Add("gate_exception_" + error.GetType().Name + ":" + error.Message); }
            if (sampleErrors.Count > 0) failures++;
            Console.WriteLine((sampleErrors.Count == 0 ? "PASS" : "FAIL") + " marker-controls bmp8 palette/gray and each of 8 erased marks checks=" +
                (sampleErrors.Count == 0 ? "ok" : String.Join(";", sampleErrors.ToArray())));
        }
        // Same font-free fixture and bilinear inverse rasterization as verify-scan-deskew.ts.
        private static int NumericalPixel(int x, int y, string kind) {
            if (x < 0 || x >= 900 || y < 0 || y >= 1200 || kind == "blank") return 255;
            if (kind == "dense") return x >= 60 && x < 840 && y >= 60 && y < 1140 ? 80 : 255;
            if (kind == "table" && x >= 80 && x <= 820 && y >= 80 && y <= 1080 && ((x - 80) % 148 == 0 || (y - 80) % 100 == 0)) return 0;
            int row = (int)Math.Floor((y - 100) / 65.0), col = (int)Math.Floor((x - 100) / 10.0);
            int gx = x - 100 - col * 10, gy = y - 100 - row * 65;
            return row >= 0 && row < 15 && col >= 0 && col < 60 && gx < 6 && gy < 10 &&
                (gx < 2 || gy < 2 || (gy >= 4 && gy < 6) || (col % 2 == 0 && gx >= 4)) ? 0 : 255;
        }
        private static byte[] NumericalPage(double angle, double physicalScale, string kind) {
            int width = 900, height = 1200;
            byte[] gray = new byte[width * height];
            double radians = angle * Math.PI / 180, cos = Math.Cos(radians), sin = Math.Sin(radians);
            for (int y = 0; y < height; y++) for (int x = 0; x < width; x++) {
                double dx = x - width / 2.0, dy = y - height / 2.0;
                double sx = (cos * dx + sin * dy + width / 2.0) / physicalScale;
                double sy = (-sin * dx + cos * dy + height / 2.0) / physicalScale;
                int ix = (int)Math.Floor(sx), iy = (int)Math.Floor(sy);
                double fx = sx - ix, fy = sy - iy;
                gray[y * width + x] = (byte)(NumericalPixel(ix, iy, kind) * (1 - fx) * (1 - fy) + NumericalPixel(ix + 1, iy, kind) * fx * (1 - fy) +
                    NumericalPixel(ix, iy + 1, kind) * (1 - fx) * fy + NumericalPixel(ix + 1, iy + 1, kind) * fx * fy);
            }
            return gray;
        }
        private static void Numerical(double[] angles, Dictionary<string, int[]> summary) {
            foreach (string kind in new string[] { "text", "blank", "dense", "table", "legacy-dpi" }) {
                int[] totals = new int[6]; summary.Add("numeric-" + kind, totals);
                foreach (double angle in kind == "legacy-dpi" ? new double[] { -4 } : angles) {
                    sampleErrors = new List<string>();
                    Estimate result = new Estimate(false, 0); result.Reason = "gate_exception";
                    bool eligible = kind == "text" && Math.Abs(angle) >= 1 && Math.Abs(angle) < Limits.MaxAngle - Limits.BoundaryMargin;
                    bool mustStay = kind != "text" || angle == 0 || Math.Abs(angle) >= Limits.MaxAngle - Limits.BoundaryMargin;
                    try {
                        result = Estimator.Analyze(NumericalPage(angle, kind == "legacy-dpi" ? 96 / Limits.DefaultDpi : 1, kind), 900, 1200, 900, true);
                        if (eligible) Require(result.Corrected, "numeric eligible fell back");
                        if (mustStay) Require(!result.Corrected, "numeric risk rotation");
                        if (result.Corrected) Require(Math.Abs(result.AngleDeg - angle) <= Limits.HalfAgreement, "numeric estimate error / wrong sign");
                        if (kind == "legacy-dpi") Require(result.Reason == "foreground_fraction", "legacy numerical reproduction changed");
                    } catch (Exception error) { sampleErrors.Add("gate_exception_" + error.GetType().Name); }
                    Record("numeric-" + kind, angle, "gray", result, totals, eligible, mustStay);
                }
            }
        }
        public static void Run(string directory) {
            double[] angles = new double[] { -Limits.MaxAngle, -4, -3, -2, -1, -Limits.MinAngle, 0, Limits.MinAngle, 1, 2, 3, 4, Limits.MaxAngle,
                -Limits.MaxAngle - Limits.CoarseStep, Limits.MaxAngle + Limits.CoarseStep, -12, 12 };
            string[] formats = new string[] { "png", "jpeg", "bmp8", "bmp24" };
            Dictionary<string, int[]> summary = new Dictionary<string, int[]>();
            Numerical(angles, summary);
            MarkerControls(directory);
            // Keep the old -4 drawing available as a diagnostic probe, not a positive control.
            try {
                using (Bitmap page = Page("text")) using (Bitmap legacy = Skew(page, -4, true)) {
                    Estimate probe = Pure(legacy);
                    Console.WriteLine("PROBE legacy-physical-dpi inputAngle=-4 format=gray corrected=" + probe.Corrected + " estimated=" + probe.AngleDeg +
                        " reason=" + probe.Reason + " sourceDpi=" + page.HorizontalResolution + " targetDpi=" + legacy.HorizontalResolution + " diagnostics=" + probe.Detail);
                }
            } catch (Exception error) { failures++; Console.WriteLine("FAIL legacy probe " + error.GetType().Name); }
            foreach (string kind in new string[] { "text", "text2x", "blank", "photo", "table", "id", "invoice" }) {
                int[] totals = new int[6]; summary.Add(kind, totals);
                Bitmap page = null;
                try {
                    foreach (double angle in angles) foreach (string format in formats) {
                        sampleErrors = new List<string>();
                        Estimate result = new Estimate(false, 0); result.Reason = "gate_exception";
                        bool mustStay = !IsText(kind) || angle == 0 || Math.Abs(angle) >= Limits.MaxAngle - Limits.BoundaryMargin;
                        bool eligible = IsText(kind) && Math.Abs(angle) >= 1 && Math.Abs(angle) < Limits.MaxAngle - Limits.BoundaryMargin;
                        try {
                            if (page == null) page = Page(kind);
                            using (Bitmap sample = Skew(page, angle, false)) {
                                if (IsText(kind)) Mark(sample);
                                Estimate pure = Pure(sample);
                                // Pure padded-stride and decoded-image paths are both positive controls.
                                if (mustStay) Require(!pure.Corrected, "pure risk rotation");
                                if (eligible) Require(pure.Corrected, "pure eligible fell back: " + pure.Reason + pure.Detail);
                                if (pure.Corrected) Require(Math.Abs(pure.AngleDeg - angle) <= Limits.HalfAgreement, "pure estimate error / wrong sign");
                                string input = Path.Combine(directory, "input." + (format.StartsWith("bmp") ? "bmp" : format == "jpeg" ? "jpg" : "png"));
                                string output = Path.Combine(directory, format == "png" ? "output.png" : "output.jpg");
                                File.Delete(input); File.Delete(output); Save(sample, input, format);
                                if (IsText(kind)) using (Bitmap decodedInput = new Bitmap(input)) InputMarkers(sample, decodedInput, format);
                                byte[] original = File.ReadAllBytes(input);
                                result = ImageProcessor.Process(input, output, true);
                                result.Detail = "source=" + sample.Width + "x" + sample.Height + " dpi=" + sample.HorizontalResolution + " analysisScale=" +
                                    Math.Min(1, (double)Limits.LongEdge / Math.Max(sample.Width, sample.Height)).ToString("F4", System.Globalization.CultureInfo.InvariantCulture) + result.Detail;
                                if (mustStay) Require(!result.Corrected && !File.Exists(output), "risk rotation/output");
                                if (eligible) Require(result.Corrected, "eligible text fell back");
                                if (result.Corrected) {
                                    Require(Math.Abs(result.AngleDeg - angle) <= Limits.HalfAgreement, "estimate error / wrong sign");
                                    ImageChecks(sample, output, result, format);
                                } else Require(!File.Exists(output), "fallback left output");
                                Require(Convert.ToBase64String(original) == Convert.ToBase64String(File.ReadAllBytes(input)), "input modified");
                            }
                        } catch (Exception error) { sampleErrors.Add("gate_exception_" + error.GetType().Name + ":" + error.Message); }
                        Record(kind, angle, format, result, totals, eligible, mustStay);
                    }
                } finally { if (page != null) page.Dispose(); }
            }
            foreach (string kind in new string[] { "broken", "alpha", "small" }) {
                sampleErrors = new List<string>(); int[] totals = new int[6]; summary.Add(kind, totals);
                Estimate result = new Estimate(false, 0); result.Reason = "gate_exception";
                try {
                    string input = Path.Combine(directory, kind + ".png"), output = Path.Combine(directory, "fault-output.png");
                    File.Delete(output);
                    if (kind == "small") result = Estimator.Analyze(new byte[1], 1, 1, 1, true);
                    else {
                        if (kind == "broken") File.WriteAllText(input, "invalid image");
                        else using (Bitmap alpha = new Bitmap(900, 1200, PixelFormat.Format32bppArgb)) { alpha.Save(input, ImageFormat.Png); }
                        result = ImageProcessor.Process(input, output, true);
                    }
                    Require(!result.Corrected && !File.Exists(output), "fault fallback/output");
                } catch (Exception error) { sampleErrors.Add("gate_exception_" + error.GetType().Name); }
                Record(kind, 0, kind == "small" ? "gray" : "png", result, totals, false, true);
            }
            Console.WriteLine("SUMMARY class | samples | expected | eligible-corrected | all-corrected | false-corrections | failures");
            foreach (KeyValuePair<string, int[]> item in summary) {
                int[] t = item.Value;
                Console.WriteLine("SUMMARY " + item.Key + " | " + t[0] + " | " + t[1] + " | " + t[2] + " | " + t[3] + " | " + t[4] + " | " + t[5]);
            }
            Console.WriteLine("scan-deskew Windows " + (failures == 0 ? "PASS" : "FAIL") + ": failedSamples=" + failures + " samples=s4a-v3 seed=1104");
            if (failures > 0) throw new Exception("scan-deskew synthetic gate: " + failures + " failed samples (all samples completed)");
        }
    }
}
'@
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('deskew-gate-' + [Guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path $temporary | Out-Null
    Add-Type -TypeDefinition ($source + $tests) -ReferencedAssemblies System.Drawing
    [ScanDeskew.SyntheticGate]::Run($temporary)
    Write-Output 'PASS C# compilation and synthetic estimator/rotation/fallback gate (Windows PowerShell 5.1)'
} finally {
    Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
}
