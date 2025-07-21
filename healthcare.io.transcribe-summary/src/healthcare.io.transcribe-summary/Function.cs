using Amazon.BedrockAgent;
using Amazon.BedrockAgent.Model;
using Amazon.BedrockAgentRuntime;
using Amazon.BedrockAgentRuntime.Model;
using Amazon.BedrockRuntime;
using Amazon.Lambda.Annotations;
using Amazon.Lambda.Core;
using Amazon.Lambda.S3Events;
using Amazon.S3;
using Amazon.S3.Model;
using System.Text;
using System.Text.Json;

// Assembly attribute to enable the Lambda function's JSON input to be converted into a .NET class.
[assembly: LambdaSerializer(typeof(Amazon.Lambda.Serialization.SystemTextJson.DefaultLambdaJsonSerializer))]

namespace healthcare.io.transcribe_summary;

public class Function
{
    private readonly IAmazonS3 _s3Client;
    private readonly IAmazonBedrockRuntime _amazonBedrock;
    private readonly IAmazonBedrockAgentRuntime _amazonBedrockAgentRuntime;
    private readonly IAmazonBedrockAgent _amazonBedrockAgent;

    public Function(
         IAmazonS3 s3Client,
         IAmazonBedrockRuntime amazonBedrock,
         IAmazonBedrockAgentRuntime amazonBedrockAgentRuntime,
         IAmazonBedrockAgent amazonBedrockAgent)
    {
        _s3Client = s3Client;
        _amazonBedrock = amazonBedrock;
        _amazonBedrockAgent = amazonBedrockAgent;
        _amazonBedrockAgentRuntime = amazonBedrockAgentRuntime;
    }


    [LambdaFunction]
    public async Task FunctionHandler(S3Event evnt, ILambdaContext context)
    {
        //測試 Amazon Bedrock Agent
        // string sessionId = Guid.NewGuid().ToString();
        // var ans1 = await TestBedrockAgent(sessionId, "jack近期發生那些事情，請一一列出");
        // var ans2 = await TestBedrockAgent(sessionId, "接下來的對話我該如何引導他讓他更正面？");
        // var ans3 = await TestBedrockAgent(sessionId, "jack過去經歷了幾次看診？然後分別對應 cpt_code 是多少？");

        // 處理 S3 事件
        await ProcessS3Event(evnt, context);

        // 同步 Bedrock knowledge base
        await SyncBedrockKnowledgeBase();

    }


    public async Task ProcessS3Event(S3Event evnt, ILambdaContext context)
    {
        foreach (var record in evnt.Records)
        {
            var bucketName = record.S3.Bucket.Name;
            var objectKey = record.S3.Object.Key;
            try
            {
                // 呼叫處理摘要的邏輯
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
        string promptAndInputText;
        if (totalChunks > 1)
        {
            promptAndInputText = $@"
        你是一位具有執照的臨床心理師。以下是病患與治療者之間的心理治療對話逐字紀錄。你的任務是將片段的逐字稿摘要其內容：

        1. 仔細分析此對話，記錄病患的身心理狀況。
        2. 請以繁體中文作答。

        對話紀錄如下：
        這是第{chunkIndex}/{totalChunks}份紀錄，對話紀錄為: {content}

        請依照以下結構化的 JSON 格式回覆：
        {{  
            ""diagnosis_summary"": ""string（逐字稿摘要，適用於 EHR）""
        }}";
        }
        else
        {
            promptAndInputText = $@"
        你是一位具有執照的臨床心理師。以下是病患與治療者之間的心理治療對話逐字紀錄。你的任務是：

        1. 紀錄病患名稱。
        2. 仔細分析此對話，以理解病患的心理狀態、壓力程度與核心症狀。
        3. 根據對話內容與時間，判斷最適當的 CPT（Current Procedural Terminology）代碼。
        4. 使用專業的 EHR（電子病歷）語言撰寫臨床摘要。
        5. 請以繁體中文作答。

        對話紀錄如下：
        {content}

        請依照以下結構化的 JSON 格式回覆：
        {{
            ""patient_name"": ""string（病患名稱）"",
            ""cpt_code"": ""string（例如：90837）"",
            ""diagnosis_summary"": ""string（臨床摘要，適用於 EHR）"",
            ""recommendations"": [""string"", ""string""]
        }}";
        }


        var requestBody = new
        {
            anthropic_version = "bedrock-2023-05-31",
            max_tokens = 2048,
            temperature = 0.3,
            top_p = 0.9,
            messages = new[]
            {
            new
            {
                role = "user",
                content = promptAndInputText
            }
            }
        };

        var requestBodyJson = JsonSerializer.Serialize(requestBody);

        var request = new Amazon.BedrockRuntime.Model.InvokeModelRequest
        {
            ModelId = "anthropic.claude-3-5-sonnet-20240620-v1:0",
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

        1. 紀錄病患名稱。
        2. 仔細分析這一些已經摘要過的對話片段，以理解病患的心理狀態、壓力程度與核心症狀。
        3. 根據對話內容與時間，判斷最適當的 CPT（Current Procedural Terminology）代碼。
        4. 使用專業的 EHR（電子病歷）語言撰寫臨床摘要。
        5. 這個摘要是從多個片段中彙整而來，請確保最終摘要能夠涵蓋所有重要資訊。
        6. 請以繁體中文作答。

        摘要彙整如下：
        {combinedSummaries}

        請依照以下結構化的 JSON 格式回覆：
        {{
            ""patient_name"": ""string（病患名稱）"",
            ""cpt_code"": ""string（例如：90837）"",
            ""diagnosis_summary"": ""string（臨床摘要，適用於 EHR）"",
            ""recommendations"": [""string"", ""string""]
        }}";

        var requestBody = new
        {
            anthropic_version = "bedrock-2023-05-31",
            max_tokens = 4096,
            temperature = 0.3,
            top_p = 0.9,
            messages = new[]
            {
            new
            {
                role = "user",
                content = promptAndInputText
            }
            }
        };

        var requestBodyJson = JsonSerializer.Serialize(requestBody);

        var request = new Amazon.BedrockRuntime.Model.InvokeModelRequest
        {
            ModelId = "anthropic.claude-3-5-sonnet-20240620-v1:0",
            Body = new MemoryStream(System.Text.Encoding.UTF8.GetBytes(requestBodyJson)),
            ContentType = "application/json",
        };

        var responseBody = await _amazonBedrock.InvokeModelAsync(request);
        var summary = responseBody.Body;
        var summaryContent = await new StreamReader(summary).ReadToEndAsync();

        // 解析 Bedrock 回應並提取實際的摘要內容
        var bedrockResponse = JsonSerializer.Deserialize<BedrockResponse>(summaryContent);
        return bedrockResponse?.Results?.FirstOrDefault()?.OutputText ?? summaryContent;
    }

    private async Task<string> TestBedrockAgent(string sessionId, string message)
    {
        try
        {
            
            var response = await _amazonBedrockAgentRuntime.InvokeAgentAsync(new InvokeAgentRequest
            {
                AgentId = "FJOAIEOHQI",
                AgentAliasId = "TUGCBDUGEX",
                SessionId = sessionId,
                InputText = message
            });

            var sb = new StringBuilder();
     
            // 正確方式：透過 response.Completion 取得資料
            await foreach (var item in response.Completion)
            {
                if (item is Amazon.BedrockAgentRuntime.Model.PayloadPart payloadPart)
                {
                    var chunk = Encoding.UTF8.GetString(payloadPart.Bytes.ToArray());
                    sb.Append(chunk);
                }
            }

            return sb.ToString();
        }
        catch (Exception ex)
        {
            return $"Error invoking Bedrock Agent: {ex.Message}";
        }

    }

    private async Task SyncBedrockKnowledgeBase()
    {

        try
        {
            // Create a request to start an ingestion job
            var request = new StartIngestionJobRequest
            {
                DataSourceId = Environment.GetEnvironmentVariable("KM_DS_ID"), // Replace with your data source ID
                KnowledgeBaseId = Environment.GetEnvironmentVariable("KM_ID"), // Replace with your knowledge base ID
                // Optional parameters
                ClientToken = Guid.NewGuid().ToString(), // For idempotency
                Description = "Syncing knowledge base data sources"
            };

            // Call the API to start the ingestion job
            var response = await _amazonBedrockAgent.StartIngestionJobAsync(request);

        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error: {ex.Message}");
        }


    }

}

