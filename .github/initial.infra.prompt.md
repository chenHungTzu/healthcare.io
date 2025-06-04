# 初始化 Infra 專案

- 請建立一組 Infra scripts 需要串連以下服務 (AWS)
- 當使用者將影音檔放置到S3 Bucket[1] 時，會觸發 Lambda 函數[2]，
  該函數會觸發 AWS Transcribe 進行語音轉文字，並將結果存放到目標S3 Bucket[3] 當中，
  會觸發另一個Lambda 函數[4] 去呼叫 AWS Bedrock 服務，為逐字稿產生聊天摘要。
  [1] : healthcare-io-audio
  [2] : healthcare-io-transcribe
  [3] : healthcare-io-transcribe-result
  [4] : healthcare-io-transcribe-summary
- 請將檔案產生至目錄 `healthcare.io.infra` 當中
- 請使用 AWS IAM 來設定 Lambda 函數的權限
  - Lambda-runtime : dotnet8
  - deployment package : ecr
- 請使用 dynamodb 來管理 terraform state
- 資源建立預設在 region : ap-northeast-1
- 以上請使用 AWS terraform scripts 來完成，依據不同的資源產生檔案，如
  - s3.tf
  - lambda.tf
  - dynamodb.tf

請依照步驟執行
