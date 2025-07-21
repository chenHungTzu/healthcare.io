using Amazon.Lambda.Annotations;
using Amazon.Lambda.Core;
using Amazon.Lambda.S3Events;
using Amazon.S3;
using Amazon.TranscribeService;

// Assembly attribute to enable the Lambda function's JSON input to be converted into a .NET class.
[assembly: LambdaSerializer(typeof(Amazon.Lambda.Serialization.SystemTextJson.DefaultLambdaJsonSerializer))]

namespace healthcare.io.transcriber;

public class Function
{
    private readonly IAmazonS3 _s3Client;
    private readonly IAmazonTranscribeService _transcribeService;


    public Function(IAmazonS3 s3Client, IAmazonTranscribeService transcribeService)
    {
        _s3Client = s3Client;
        _transcribeService = transcribeService;
    }

    [LambdaFunction]
    public async Task FunctionHandler(S3Event evnt, ILambdaContext context)
    {

        foreach (var record in evnt.Records)
        {

            // 這邊取得 S3 事件中的 bucket 和 object key
            var bucketName = record.S3.Bucket.Name;
            var objectKey = record.S3.Object.Key;
            var distinationBucketName = "healthcare-io-transcribe-result";

            try
            {
                await ProcessTranscription(bucketName, objectKey, distinationBucketName, context);
            }
            catch (Exception ex)
            {
                context.Logger.LogError($"Error processing S3 event: {ex.Message}");
                throw;
            }


        }
    }

    public async Task ProcessTranscription(string bucketName, string objectKey, string distinationBucketName, ILambdaContext context)
    {

        // 呼叫 Transcribe API 進行轉錄
        var transcriptionJobName = $"{objectKey}-{Guid.NewGuid()}";
        var mediaUri = $"s3://{bucketName}/{objectKey}";

        var request = new Amazon.TranscribeService.Model.StartTranscriptionJobRequest
        {
            TranscriptionJobName = transcriptionJobName,
            Media = new Amazon.TranscribeService.Model.Media
            {
                MediaFileUri = mediaUri
            },
            // 自動多語言識別
            IdentifyLanguage = true,
            // 可選：限制語言識別範圍，提高準確度
            LanguageOptions = new List<string>
            {
                "zh-TW", // 繁體中文       
                "en-US", // 英文
            },
            MediaFormat = Amazon.TranscribeService.MediaFormat.Webm, // 根據實際檔案格式調整
            OutputBucketName = distinationBucketName, // 將轉錄結果輸出到指定的 S3 bucket
            OutputKey = $"transcribe-result/{DateTime.UtcNow:yyyyMMddHHmmss}/{objectKey}-{Guid.NewGuid()}.json", // 指定輸出檔案的 key
            // Additional useful parameters for healthcare transcriptions
            Settings = new Amazon.TranscribeService.Model.Settings
            {
                ShowSpeakerLabels = true, // 識別不同發言者
                MaxSpeakerLabels = 2, // 預期醫生和病人（最多2個發言者）
                ShowAlternatives = true, // 顯示替代轉錄結果
                MaxAlternatives = 2 // 最多顯示2個替代結果
            },
        };

        await _transcribeService.StartTranscriptionJobAsync(request);
    }
}
