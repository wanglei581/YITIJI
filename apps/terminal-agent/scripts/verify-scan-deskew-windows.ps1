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
        private static int rotations = 0, eligible = 0, corrected = 0;
        private static void Require(bool condition, string message) {
            if (!condition) throw new Exception(message);
        }
        private static Bitmap Page(string kind) {
            Bitmap page = new Bitmap(900, 1200, PixelFormat.Format24bppRgb);
            page.SetResolution((float)Limits.DefaultDpi, (float)Limits.DefaultDpi);
            using (Graphics g = Graphics.FromImage(page)) {
                g.Clear(Color.White);
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
        private static Bitmap Skew(Bitmap page, double angle) {
            Bitmap sample = new Bitmap(page.Width, page.Height, PixelFormat.Format24bppRgb);
            using (Graphics g = Graphics.FromImage(sample)) {
                g.Clear(Color.White);
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.TranslateTransform(sample.Width / 2f, sample.Height / 2f);
                g.RotateTransform((float)angle);
                g.TranslateTransform(-page.Width / 2f, -page.Height / 2f);
                g.DrawImageUnscaled(page, 0, 0);
            }
            return sample;
        }
        private static byte[] Gray(Bitmap page, int stride) {
            byte[] gray = new byte[stride * page.Height];
            for (int y = 0; y < page.Height; y++) for (int x = 0; x < page.Width; x++) {
                Color c = page.GetPixel(x, y);
                gray[y * stride + x] = (byte)((c.R * 299 + c.G * 587 + c.B * 114) / 1000);
            }
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
        private static void Preserved(Bitmap sample, Bitmap rotated, double angle) {
            double radians = -angle * Math.PI / 180, cos = Math.Cos(radians), sin = Math.Sin(radians);
            Require(rotated.Width == (int)Math.Ceiling(sample.Width * cos + sample.Height * Math.Abs(sin)), "canvas width");
            Require(rotated.Height == (int)Math.Ceiling(sample.Height * cos + sample.Width * Math.Abs(sin)), "canvas height");
            foreach (Point p in MarkerPoints(sample)) {
                double x = p.X - sample.Width / 2.0, y = p.Y - sample.Height / 2.0;
                int cx = (int)Math.Round(cos * x - sin * y + rotated.Width / 2.0);
                int cy = (int)Math.Round(sin * x + cos * y + rotated.Height / 2.0);
                bool found = false;
                for (int dy = -4; dy <= 4; dy++) for (int dx = -4; dx <= 4; dx++) {
                    if (cx + dx < 0 || cx + dx >= rotated.Width || cy + dy < 0 || cy + dy >= rotated.Height) continue;
                    Color c = rotated.GetPixel(cx + dx, cy + dy);
                    if (c.R > 150 && c.B > 150 && c.G < 120) found = true;
                }
                Require(found, "lost original corner/edge marker");
            }
        }
        public static void Run(string directory) {
            double[] angles = new double[] { -Limits.MaxAngle, -4, -3, -2, -1, -Limits.MinAngle, 0, Limits.MinAngle, 1, 2, 3, 4, Limits.MaxAngle,
                -Limits.MaxAngle - Limits.CoarseStep, Limits.MaxAngle + Limits.CoarseStep, -12, 12 };
            string[] formats = new string[] { "png", "jpeg", "bmp8", "bmp24" };
            foreach (string kind in new string[] { "text", "blank", "photo", "table", "id", "invoice" }) {
                using (Bitmap page = Page(kind)) foreach (double angle in angles) using (Bitmap sample = Skew(page, angle)) {
                    if (kind == "text") Mark(sample);
                    // Verify the pure estimator separately, including padded row stride.
                    Estimate pure = Estimator.Analyze(Gray(sample, sample.Width + 4), sample.Width, sample.Height, sample.Width + 4);
                    bool mustStay = kind != "text" || angle == 0 || Math.Abs(angle) >= Limits.MaxAngle - Limits.BoundaryMargin;
                    if (mustStay) Require(!pure.Corrected, kind + " pure risk rotation at " + angle);
                    if (pure.Corrected) Require(Math.Abs(pure.AngleDeg - angle) <= Limits.HalfAgreement, "pure estimate error / wrong sign");
                    foreach (string format in formats) {
                        string input = Path.Combine(directory, "input." + (format.StartsWith("bmp") ? "bmp" : format == "jpeg" ? "jpg" : "png"));
                        string output = Path.Combine(directory, format == "png" ? "output.png" : "output.jpg");
                        File.Delete(input); File.Delete(output); Save(sample, input, format);
                        byte[] original = File.ReadAllBytes(input);
                        Estimate result = ImageProcessor.Process(input, output);
                        if (mustStay) Require(!result.Corrected && !File.Exists(output), kind + " risk rotation at " + angle + " " + format);
                        if (kind == "text" && Math.Abs(angle) >= 1 && Math.Abs(angle) < Limits.MaxAngle - Limits.BoundaryMargin) {
                            eligible++;
                            // Positive controls prevent an all-fallback implementation passing the gate.
                            Require(result.Corrected, "eligible text fell back: " + angle + " " + format);
                            corrected++;
                        }
                        if (result.Corrected) {
                            rotations++;
                            Require(Math.Abs(result.AngleDeg - angle) <= Limits.HalfAgreement, "estimate error / wrong sign");
                            Corners(output);
                            using (Bitmap rotated = new Bitmap(output)) {
                                Require(rotated.Width >= sample.Width && rotated.Height >= sample.Height, "cropped canvas");
                                Preserved(sample, rotated, result.AngleDeg);
                                // Direction proof: residual skew after actual encoding/rotation must be small.
                                double scale = Math.Min(1, (double)Limits.LongEdge / Math.Max(rotated.Width, rotated.Height));
                                using (Bitmap small = new Bitmap(rotated, (int)(rotated.Width * scale), (int)(rotated.Height * scale))) {
                                    Estimate residual = Estimator.Analyze(Gray(small, small.Width), small.Width, small.Height, small.Width);
                                    Require(Math.Abs(residual.AngleDeg) <= Limits.HalfAgreement, "rotation residual / wrong sign");
                                }
                            }
                        }
                        Require(Convert.ToBase64String(original) == Convert.ToBase64String(File.ReadAllBytes(input)), "input modified");
                        Console.WriteLine("PASS synthetic " + kind + " " + angle + " " + format + " corrected=" + result.Corrected + " angle=" + result.AngleDeg);
                    }
                }
            }
            string broken = Path.Combine(directory, "broken.png"), brokenOutput = Path.Combine(directory, "broken-output.png");
            File.WriteAllText(broken, "invalid image");
            Require(!ImageProcessor.Process(broken, brokenOutput).Corrected && !File.Exists(brokenOutput), "damaged input");
            using (Bitmap alpha = new Bitmap(900, 1200, PixelFormat.Format32bppArgb)) {
                string input = Path.Combine(directory, "alpha.png"); alpha.Save(input, ImageFormat.Png);
                Require(!ImageProcessor.Process(input, brokenOutput).Corrected, "transparent input");
            }
            Require(!Estimator.Analyze(new byte[1], 1, 1, 1).Corrected, "small input");
            Require(eligible > 0 && eligible == corrected, "no positive controls");
            Console.WriteLine("scan-deskew Windows PASS: rotations=" + rotations + " eligible=" + eligible + " corrected=" + corrected + " risk rotations=0 samples=s4a-v1 seed=1104");
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
