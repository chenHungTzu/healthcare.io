# 使用 .NET 8 AWS Lambda 執行環境的 Dockerfile 範例
FROM public.ecr.aws/lambda/dotnet:8 AS base

# 複製專案檔案
WORKDIR /var/task
COPY src/healthcare.io.transcriber/bin/Debug/net8.0/ ./

# Lambda 入口點
CMD ["healthcare.io.transcriber::healthcare.io.transcriber.Function_FunctionHandler_Generated::FunctionHandler"]
