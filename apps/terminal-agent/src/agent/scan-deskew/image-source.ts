/** Decode/resize/rotate/encode is isolated from the pure estimator. C# 5 only. */
export const IMAGE_SOURCE = String.raw`
using System;
using System.IO;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
namespace ScanDeskew {
    public static class ImageProcessor {
        public static Estimate Process(string input, string output) {
            try {
                using (Image source = Image.FromFile(input)) {
                    string extension = Path.GetExtension(input).ToLowerInvariant();
                    Guid format = source.RawFormat.Guid;
                    if (!((extension == ".png" && format == ImageFormat.Png.Guid) ||
                        ((extension == ".jpg" || extension == ".jpeg") && format == ImageFormat.Jpeg.Guid) ||
                        (extension == ".bmp" && format == ImageFormat.Bmp.Guid))) return new Estimate(false, 0);
                    if (source.Width < Limits.MinDimension || source.Height < Limits.MinDimension ||
                        source.Width > Limits.MaxDimension || source.Height > Limits.MaxDimension ||
                        (long)source.Width * source.Height > Limits.MaxPixels)
                        return new Estimate(false, 0);
                    foreach (Guid dimension in source.FrameDimensionsList)
                        if (source.GetFrameCount(new FrameDimension(dimension)) != 1) return new Estimate(false, 0);
                    // Any non-opaque pixel is uncertain; never silently flatten transparency.
                    using (Bitmap original = new Bitmap(source)) {
                        if (!Opaque(original)) return new Estimate(false, 0);
                        double scale = Math.Min(1, (double)Limits.LongEdge / Math.Max(source.Width, source.Height));
                        using (Bitmap small = new Bitmap((int)(source.Width * scale), (int)(source.Height * scale), PixelFormat.Format24bppRgb)) {
                            using (Graphics g = Graphics.FromImage(small)) {
                                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                                g.DrawImage(original, new Rectangle(0, 0, small.Width, small.Height));
                            }
                            byte[] gray = Gray(small);
                            Estimate estimate = Estimator.Analyze(gray, small.Width, small.Height, small.Width);
                            if (!estimate.Corrected) return estimate;
                            Color background = Background(small);
                            Rotate(original, output, extension == ".png", -estimate.AngleDeg, background, source.HorizontalResolution, source.VerticalResolution);
                            // Close output first, then reopen and force a full decode before publishing success.
                            using (Image check = Image.FromFile(output)) using (Bitmap decoded = new Bitmap(check)) {
                                if (decoded.Width < original.Width || decoded.Height < original.Height ||
                                    check.RawFormat.Guid != (extension == ".png" ? ImageFormat.Png.Guid : ImageFormat.Jpeg.Guid))
                                    throw new InvalidDataException();
                            }
                            return estimate;
                        }
                    }
                }
            } catch {
                try { File.Delete(output); } catch { }
                return new Estimate(false, 0);
            }
        }
        private static bool Opaque(Bitmap image) {
            BitmapData data = image.LockBits(new Rectangle(0, 0, image.Width, image.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            try {
                byte[] row = new byte[image.Width * 4];
                for (int y = 0; y < image.Height; y++) {
                    Marshal.Copy(IntPtr.Add(data.Scan0, y * data.Stride), row, 0, row.Length);
                    for (int x = 3; x < row.Length; x += 4) if (row[x] != 255) return false;
                }
                return true;
            } finally { image.UnlockBits(data); }
        }
        private static byte[] Gray(Bitmap image) {
            byte[] gray = new byte[image.Width * image.Height];
            BitmapData data = image.LockBits(new Rectangle(0, 0, image.Width, image.Height), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
            try {
                byte[] row = new byte[image.Width * 3];
                for (int y = 0; y < image.Height; y++) {
                    Marshal.Copy(IntPtr.Add(data.Scan0, y * data.Stride), row, 0, row.Length);
                    for (int x = 0; x < image.Width; x++) gray[y * image.Width + x] = (byte)((row[x * 3] * 114 + row[x * 3 + 1] * 587 + row[x * 3 + 2] * 299) / 1000);
                }
            } finally { image.UnlockBits(data); }
            return gray;
        }
        private static Color Background(Bitmap image) {
            long r = 0, g = 0, b = 0; int n = 0; bool reliable = true;
            for (int y = 0; y < image.Height; y++) for (int x = 0; x < image.Width; x++) {
                if (x >= image.Width * Limits.Border && x < image.Width * (1 - Limits.Border) &&
                    y >= image.Height * Limits.Border && y < image.Height * (1 - Limits.Border)) continue;
                Color c = image.GetPixel(x, y);
                if (Math.Min(c.R, Math.Min(c.G, c.B)) < Limits.MinBackground) reliable = false;
                r += c.R; g += c.G; b += c.B; n++;
            }
            return reliable && n > 0 ? Color.FromArgb((int)(r / n), (int)(g / n), (int)(b / n)) : Color.White;
        }
        private static float Dpi(float value) {
            return !Single.IsNaN(value) && !Single.IsInfinity(value) && value >= Limits.MinDpi && value <= Limits.MaxDpi ? value : (float)Limits.DefaultDpi;
        }
        private static void Rotate(Bitmap original, string output, bool png, double angle, Color background, float dpiX, float dpiY) {
            double radians = angle * Math.PI / 180, sin = Math.Abs(Math.Sin(radians)), cos = Math.Abs(Math.Cos(radians));
            int width = (int)Math.Ceiling(original.Width * cos + original.Height * sin);
            int height = (int)Math.Ceiling(original.Height * cos + original.Width * sin);
            using (Bitmap result = new Bitmap(width, height, PixelFormat.Format24bppRgb)) {
                result.SetResolution(Dpi(dpiX), Dpi(dpiY));
                using (Graphics g = Graphics.FromImage(result)) {
                    g.Clear(background);
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    g.TranslateTransform(width / 2f, height / 2f);
                    g.RotateTransform((float)angle);
                    g.TranslateTransform(-original.Width / 2f, -original.Height / 2f);
                    using (ImageAttributes attributes = new ImageAttributes()) {
                        attributes.SetWrapMode(WrapMode.TileFlipXY);
                        g.DrawImage(original, new Rectangle(0, 0, original.Width, original.Height), 0, 0, original.Width, original.Height, GraphicsUnit.Pixel, attributes);
                    }
                }
                using (FileStream stream = new FileStream(output, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
                    if (png) result.Save(stream, ImageFormat.Png);
                    else {
                        ImageCodecInfo jpeg = null;
                        foreach (ImageCodecInfo codec in ImageCodecInfo.GetImageEncoders()) if (codec.FormatID == ImageFormat.Jpeg.Guid) jpeg = codec;
                        if (jpeg == null) throw new InvalidDataException();
                        using (EncoderParameters parameters = new EncoderParameters(1)) {
                            parameters.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, (long)Limits.JpegQuality);
                            result.Save(stream, jpeg, parameters);
                        }
                    }
                    stream.Flush(true);
                }
            }
        }
    }
}
`;
