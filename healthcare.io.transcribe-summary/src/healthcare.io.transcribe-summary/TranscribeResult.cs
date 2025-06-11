using System.Text.Json.Serialization;

namespace healthcare.io.transcribe_summary;

public class TranscribeResult
{
    [JsonPropertyName("results")]
    public Results Results { get; set; } = new();
}

public class Results
{
    [JsonPropertyName("transcripts")]
    public List<Transcript> Transcripts { get; set; } = new();

    [JsonPropertyName("items")]
    public List<Item> Items { get; set; } = new();

    [JsonPropertyName("speaker_labels")]
    public SpeakerLabels SpeakerLabels { get; set; } = new();
}

public class Transcript
{
    [JsonPropertyName("transcript")]
    public string Content { get; set; } = string.Empty;
}

public class Item
{
    [JsonPropertyName("start_time")]
    public string? StartTime { get; set; }

    [JsonPropertyName("end_time")]
    public string? EndTime { get; set; }

    [JsonPropertyName("alternatives")]
    public List<Alternative> Alternatives { get; set; } = new();

    [JsonPropertyName("type")]
    public string Type { get; set; } = string.Empty;

    [JsonPropertyName("speaker_label")]
    public string? SpeakerLabel { get; set; }
}

public class Alternative
{
    [JsonPropertyName("confidence")]
    public string? Confidence { get; set; }

    [JsonPropertyName("content")]
    public string Content { get; set; } = string.Empty;
}

public class SpeakerLabels
{
    [JsonPropertyName("speakers")]
    public int Speakers { get; set; }

    [JsonPropertyName("segments")]
    public List<Segment> Segments { get; set; } = new();
}

public class Segment
{
    [JsonPropertyName("start_time")]
    public string StartTime { get; set; } = string.Empty;

    [JsonPropertyName("end_time")]
    public string EndTime { get; set; } = string.Empty;

    [JsonPropertyName("speaker_label")]
    public string SpeakerLabel { get; set; } = string.Empty;

    [JsonPropertyName("items")]
    public List<SegmentItem> Items { get; set; } = new();
}

public class SegmentItem
{
    [JsonPropertyName("start_time")]
    public string StartTime { get; set; } = string.Empty;

    [JsonPropertyName("end_time")]
    public string EndTime { get; set; } = string.Empty;

    [JsonPropertyName("speaker_label")]
    public string SpeakerLabel { get; set; } = string.Empty;
}
