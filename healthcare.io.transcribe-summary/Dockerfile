FROM public.ecr.aws/lambda/dotnet:8 AS base

WORKDIR /var/task
COPY src/healthcare.io.transcribe-summary/bin/Debug/net8.0/ ./

CMD ["healthcare.io.transcribe-summary::healthcare.io.transcribe_summary.Function_FunctionHandler_Generated::FunctionHandler"]
