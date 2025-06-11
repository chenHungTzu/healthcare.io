using Amazon.BedrockRuntime;
using Amazon.Lambda.Annotations;
using Amazon.Lambda.Core;
using Amazon.Lambda.S3Events;
using Amazon.S3;
using Amazon.S3.Model;
using Amazon.S3.Util;
using System.Text;
using System.Text.Json;

// Assembly attribute to enable the Lambda function's JSON input to be converted into a .NET class.
[assembly: LambdaSerializer(typeof(Amazon.Lambda.Serialization.SystemTextJson.DefaultLambdaJsonSerializer))]

namespace healthcare.io.transcribe_summary;

public class Function
{
    private readonly IAmazonS3 _s3Client;
    private readonly IAmazonBedrockRuntime _amazonBedrock;

    public Function(IAmazonS3 s3Client, IAmazonBedrockRuntime amazonBedrock)
    {
        _s3Client = s3Client;
        _amazonBedrock = amazonBedrock;
    }


    [LambdaFunction]
    public async Task FunctionHandler(S3Event evnt, ILambdaContext context)
    {
        foreach (var record in evnt.Records)
        {
            var bucketName = record.S3.Bucket.Name;
            var objectKey = record.S3.Object.Key;
            try
            {

                await ProcessSummary(bucketName, objectKey);
            }
            catch (Exception ex)
            {
                context.Logger.LogError($"Error processing S3 event: {ex.Message}");
                throw;
            }

        }
    }

    public async Task ProcessSummary(string bucketName, string objectKey)
    {

        // 根據來源下載s3 檔案
        // 讀取 .json 檔案內容為純文字格式
        var response = await _s3Client.GetObjectAsync(bucketName, objectKey);
        using var responseStream = response.ResponseStream;
        using var reader = new StreamReader(responseStream);
        var content = await reader.ReadToEndAsync();

        // 解析 AWS Transcribe 結果並提取 speaker + content
        var transcribeResult = JsonSerializer.Deserialize<TranscribeResult>(content);
        var speakerContent = new StringBuilder();

        // 從 items 中提取每個說話者的內容
        foreach (var item in transcribeResult.Results.Items)
        {
            if (item.Type == "pronunciation" && !string.IsNullOrEmpty(item.SpeakerLabel))
            {
                var speaker = item.SpeakerLabel;
                var text = item.Alternatives?.FirstOrDefault()?.Content;

                if (!string.IsNullOrEmpty(text))
                    speakerContent.AppendLine($"{speaker}: {text}");

            }
        }

        if (string.IsNullOrEmpty(speakerContent.ToString()))
            throw new Exception("No valid speaker content found in the transcription result.");

        var contentText = speakerContent.ToString();
        var allSummaries = new List<string>();

        // 檢查是否需要切分
        if (TokenHelper.ExceedsTokenLimit(contentText))
        {
            // 切分內容為多個 chunks
            var chunks = TokenHelper.SplitTextByTokenLimit(contentText);

            foreach (var (chunk, index) in chunks.Select((c, i) => (c, i)))
            {
                var chunkSummary = await ProcessChunk(chunk, index + 1, chunks.Count);
                allSummaries.Add(chunkSummary);
            }

            // 如果有多個摘要，再做一次總結
            if (allSummaries.Count > 1)
            {
                var combinedSummaries = string.Join("\n\n--- 片段分隔 ---\n\n", allSummaries);
                var finalSummary = await ProcessFinalSummary(combinedSummaries);
                allSummaries = new List<string> { finalSummary };
            }
        }
        else
        {
            // 內容不需要切分，直接處理
            var summary = await ProcessChunk(contentText, 1, 1);
            allSummaries.Add(summary);
        }

        var actualSummary = string.Join("\n\n", allSummaries);

        // 將摘要結果上傳到 S3
        var summaryObjectKey = $"summary-result/{Path.GetFileNameWithoutExtension(objectKey)}-summary.json";
        var putRequest = new PutObjectRequest
        {
            BucketName = bucketName,
            Key = summaryObjectKey,
            ContentType = "application/json",
            ContentBody = actualSummary
        };
        var putResponse = await _s3Client.PutObjectAsync(putRequest);

    }

    private async Task<string> ProcessChunk(string content, int chunkIndex, int totalChunks)
    {
        string promptAndInputText = string.Empty;
        if (totalChunks > 1)
        {
            promptAndInputText = $@"
        
        你是一位具有執照的臨床心理師。以下是病患與治療者之間的心理治療對話逐字紀錄。你的任務是將片段的逐字稿摘要其內容：

        1. 仔細分析此對話，記錄病患的身心理狀況。
        2. 請以繁體中文作答。

        對話紀錄如下：
        {"這是第({chunkIndex}/{totalChunks})份紀錄，內容為 : {content}"}

        請依照以下結構化的 JSON 格式回覆：
        {{  
            ""diagnosis_summary"": ""string（逐字稿摘要，適用於 EHR）"",
        }}";

        }
        else
        {


            promptAndInputText = $@"
        
        你是一位具有執照的臨床心理師。以下是病患與治療者之間的心理治療對話逐字紀錄。你的任務是：

        1. 仔細分析此對話，以理解病患的心理狀態、壓力程度與核心症狀。
        2. 根據對話內容與時間，判斷最適當的 CPT（Current Procedural Terminology）代碼。
        3. 使用專業的 EHR（電子病歷）語言撰寫臨床摘要。
        4. 請以繁體中文作答。

        對話紀錄如下：
        {content}

        請依照以下結構化的 JSON 格式回覆：
        {{
            ""cpt_code"": ""string（例如：90837）"",
            ""diagnosis_summary"": ""string（臨床摘要，適用於 EHR）"",
            ""recommendations"": [""string"", ""string""]
        }}";


        }


        var requestBody = new
        {
            inputText = promptAndInputText,
            textGenerationConfig = new
            {
                maxTokenCount = 2048,
                temperature = 0.3,
                topP = 0.9
            }
        };

        var requestBodyJson = JsonSerializer.Serialize(requestBody);

        var request = new Amazon.BedrockRuntime.Model.InvokeModelRequest
        {
            ModelId = "amazon.titan-text-express-v1",
            Body = new MemoryStream(Encoding.UTF8.GetBytes(requestBodyJson)),
            ContentType = "application/json",
        };

        var responseBody = await _amazonBedrock.InvokeModelAsync(request);
        var summary = responseBody.Body;
        var summaryContent = await new StreamReader(summary).ReadToEndAsync();

        // 解析 Bedrock 回應並提取實際的摘要內容
        var bedrockResponse = JsonSerializer.Deserialize<BedrockResponse>(summaryContent);
        return bedrockResponse?.Results?.FirstOrDefault()?.OutputText ?? summaryContent;
    }

    private async Task<string> ProcessFinalSummary(string combinedSummaries)
    {
        string promptAndInputText = $@"
        
        你是一位具有執照的臨床心理師。以下是病患與治療者之間的心理治療對話逐字紀錄。你的任務是：

        1. 仔細分析這一些已經摘要過的對話片段，以理解病患的心理狀態、壓力程度與核心症狀。
        2. 根據對話內容與時間，判斷最適當的 CPT（Current Procedural Terminology）代碼。
        3. 使用專業的 EHR（電子病歷）語言撰寫臨床摘要。
        4. 這個摘要是從多個片段中彙整而來，請確保最終摘要能夠涵蓋所有重要資訊。
        5. 請以繁體中文作答。

        摘要彙整如下：
        {combinedSummaries}

        請依照以下結構化的 JSON 格式回覆：
        {{
            ""cpt_code"": ""string（例如：90837）"",
            ""diagnosis_summary"": ""string（臨床摘要，適用於 EHR）"",
            ""recommendations"": [""string"", ""string""]
        }}";

        var requestBody = new
        {
            inputText = promptAndInputText,
            textGenerationConfig = new
            {
                maxTokenCount = 2048,
                temperature = 0.3,
                topP = 0.9
            }
        };

        var requestBodyJson = JsonSerializer.Serialize(requestBody);

        var request = new Amazon.BedrockRuntime.Model.InvokeModelRequest
        {
            ModelId = "amazon.titan-text-express-v1",
            Body = new MemoryStream(System.Text.Encoding.UTF8.GetBytes(requestBodyJson)),
            ContentType = "application/json"
        };

        var responseBody = await _amazonBedrock.InvokeModelAsync(request);
        var summary = responseBody.Body;
        var summaryContent = await new StreamReader(summary).ReadToEndAsync();

        // 解析 Bedrock 回應並提取實際的摘要內容
        var bedrockResponse = JsonSerializer.Deserialize<BedrockResponse>(summaryContent);
        return bedrockResponse?.Results?.FirstOrDefault()?.OutputText ?? summaryContent;
    }

}
