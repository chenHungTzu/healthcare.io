resource "local_file" "local_file_iac_enviroment_taskfile" {
  content  = <<EOF
ACCOUNT_ID=${data.aws_caller_identity.current.account_id}
ECR_TRANSCRIBE_URL=${aws_ecr_repository.transcribe_repo.repository_url}
LAMBDA_TRANSCRIBE_ARN=${aws_lambda_function.transcribe.arn}
ECR_TRANSCRIBE_SUMMARY_URL=${aws_ecr_repository.summary_repo.repository_url}
LAMBDA_TRANSCRIBE_SUMMARY_ARN=${aws_lambda_function.transcribe_summary.arn}
  EOF
  filename = "../Taskfile.iac.env"
}
