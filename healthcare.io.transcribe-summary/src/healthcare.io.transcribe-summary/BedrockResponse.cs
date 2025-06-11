using System.Text.Json.Serialization;

namespace healthcare.io.transcribe_summary;

public class BedrockResponse
{
    [JsonPropertyName("results")]
    public List<BedrockResult> Results { get; set; } = new();
}

public class BedrockResult
{
    [JsonPropertyName("outputText")]
    public string OutputText { get; set; } = string.Empty;

    [JsonPropertyName("completionReason")]
    public string CompletionReason { get; set; } = string.Empty;
}
