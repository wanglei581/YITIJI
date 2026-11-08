/** C# 5 source shared by the production subprocess and Windows gate. */
export const THRESHOLDS_SOURCE = String.raw`
namespace ScanDeskew {
    public static class Limits {
        public const int LongEdge = 1200, MinDimension = 300, MinBands = 3;
        public const double Border = 0.05, MinInk = 0.005, MaxInk = 0.35;
        public const double MinBandWidth = 0.30, MaxAngle = 5.0;
        public const double CoarseStep = 0.5, FineStep = 0.1, BoundaryMargin = 0.2;
        public const double ZeroGain = 0.08, PeakGain = 0.12, PeakDistance = 1.0;
        public const double HalfAgreement = 0.3, BandAgreement = 0.5, MinAngle = 0.2;
        public const int JpegQuality = 75, MinBackground = 180, InkContrast = 45;
        public const int MinGlyphs = 30, MinGlyphArea = 3, MaxDimension = 16000;
        public const long MaxPixels = 60000000;
        public const double MaxLineWidth = 0.30, MaxLineHeight = 0.15;
        public const double MaxGlyphWidth = 0.08, MaxGlyphHeight = 0.05;
        public const double MaxGlyphArea = 0.005, MinGlyphRatio = 0.10, MaxGlyphRatio = 10;
        public const double MinKeptInk = 0.70, MinRowInk = 0.015;
        public const int BandGap = 3, MinBandHeight = 3;
        public const double MinDpi = 72, MaxDpi = 1200, DefaultDpi = 300;
        public const int TimeoutMs = 2000;
    }
    public sealed class Estimate {
        public bool Corrected;
        public double AngleDeg;
        // Internal diagnostics; Detail is populated only by explicit gate requests.
        public string Reason = "not_analyzed", Detail = "";
        public Estimate(bool corrected, double angle) { Corrected = corrected; AngleDeg = angle; }
    }
}
`;
