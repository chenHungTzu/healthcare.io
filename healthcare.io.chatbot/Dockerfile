# 使用 .NET 8 AWS Lambda 執行環境的 Dockerfile 範例
FROM public.ecr.aws/lambda/dotnet:8 AS base

# 複製專案檔案
WORKDIR /var/task
COPY src/healthcare.io.chatbot/bin/Debug/net8.0/ ./

# Lambda 入口點
CMD ["healthcare.io.chatbot::healthcare.io.chatbot.Function_FunctionHandler_Generated::FunctionHandler"]
