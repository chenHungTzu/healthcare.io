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

resource "local_file" "local_file_fronted_env_output" {
  content  = <<EOF
export const base = {
  identity_pool_id: "${aws_cognito_identity_pool.anonymous_patient_idp.id}",
  kvs_channel_arn: "${awscc_kinesisvideo_signaling_channel.provider_channel.arn}",
  kvs_role_arn: "${aws_iam_role.kvs_sts_role.arn}",
  region: "${data.aws_region.current.name}",
  audioBucketName: "${aws_s3_bucket.audio.bucket}"
};
EOF
  filename = "../healthcare.io.ui/src/environments/environment.base.ts"
}
