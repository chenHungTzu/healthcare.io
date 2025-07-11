using Amazon.Lambda.Annotations;
using Amazon.Lambda.Core;
using Amazon.Lambda.S3Events;
using Amazon.S3;
using Amazon.S3.Util;
using Amazon.TranscribeService;
using System.Text.Json;

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
            MediaFormat = Amazon.TranscribeService.MediaFormat.Webm, // 根據實際檔案格式調整       
            LanguageCode = Amazon.TranscribeService.LanguageCode.ZhTW, // 根據實際語言調整
            OutputBucketName = distinationBucketName, // 將轉錄結果輸出到同一個 S3 bucket
            OutputKey = $"transcribe-result/{DateTime.UtcNow:yyyyMMddHHmmss}/{objectKey}-{Guid.NewGuid()}.json", // 指定輸出檔案的 key

            // Additional useful parameters for healthcare transcriptions
            Settings = new Amazon.TranscribeService.Model.Settings
            {
                ShowSpeakerLabels = true, // 識別不同發言者
                MaxSpeakerLabels = 2, // 預期醫生和病人
                ShowAlternatives = true,
                MaxAlternatives = 2
            },
        };

        await _transcribeService.StartTranscriptionJobAsync(request);
    }
}
