# transcribe
resource "aws_ecr_repository" "transcribe_repo" {
  force_delete = true
  name         = "healthcare-io-transcribe"

  provisioner "local-exec" {
    command = <<EOF
        aws ecr get-login-password --region ${data.aws_region.current.name} | docker login --username AWS --password-stdin ${data.aws_caller_identity.current.account_id}.dkr.ecr.${data.aws_region.current.name}.amazonaws.com
        EOF
  }

  provisioner "local-exec" {
    command = <<EOF
      docker pull alpine
      EOF
  }

  provisioner "local-exec" {
    command = <<EOF
      docker tag alpine ${self.repository_url}:latest
      EOF
  }

  provisioner "local-exec" {
    command = <<EOF
      docker push ${self.repository_url}:latest
      EOF
  }
}
resource "aws_iam_role" "lambda_transcribe_role" {
  name = "healthcare-io-transcribe-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}
resource "aws_iam_role_policy_attachment" "lambda_transcribe_policy" {
  role       = aws_iam_role.lambda_transcribe_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}
resource "aws_iam_role_policy" "lambda_transcribe_custom_policy" {
  name = "healthcare-io-transcribe-custom-policy"
  role = aws_iam_role.lambda_transcribe_role.id

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Action = [
          "transcribe:StartTranscriptionJob",
          "transcribe:GetTranscriptionJob",
          "transcribe:ListTranscriptionJobs",
          "transcribe:DeleteTranscriptionJob"
        ],
        Resource = "*"
      },
      {
        Effect = "Allow",
        Action = [
          "s3:GetObject",
          "s3:PutObject"
        ],
        Resource = [
          "arn:aws:s3:::healthcare-io-audio/*",
        ]
      }
    ]
  })
}
resource "aws_lambda_function" "transcribe" {
  function_name = "healthcare-io-transcribe"
  role          = aws_iam_role.lambda_transcribe_role.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.transcribe_repo.repository_url}:latest"
  timeout       = 300
  memory_size   = 512
  architectures = ["arm64"]
  lifecycle {
    create_before_destroy = true
  }

  depends_on = [aws_ecr_repository.transcribe_repo]
}
resource "aws_lambda_permission" "allow_s3_invoke_transcribe" {
  statement_id  = "AllowExecutionFromS3"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.transcribe.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.audio.arn
}
resource "aws_s3_bucket_notification" "audio_lambda_trigger" {
  bucket = aws_s3_bucket.audio.id
  lambda_function {
    lambda_function_arn = aws_lambda_function.transcribe.arn
    events              = ["s3:ObjectCreated:*"]
  }
  depends_on = [aws_lambda_permission.allow_s3_invoke_transcribe]
}

# summary
resource "aws_ecr_repository" "summary_repo" {
  force_delete = true
  name         = "healthcare-io-transcribe-summary"

  provisioner "local-exec" {
    command = <<EOF
        aws ecr get-login-password --region ${data.aws_region.current.name} | docker login --username AWS --password-stdin ${data.aws_caller_identity.current.account_id}.dkr.ecr.${data.aws_region.current.name}.amazonaws.com
        EOF
  }

  provisioner "local-exec" {
    command = <<EOF
      docker pull alpine
      EOF
  }

  provisioner "local-exec" {
    command = <<EOF
      docker tag alpine ${self.repository_url}:latest
      EOF
  }

  provisioner "local-exec" {
    command = <<EOF
      docker push ${self.repository_url}:latest
      EOF
  }
}
resource "aws_iam_role" "lambda_summary_role" {
  name = "healthcare-io-transcribe-summary-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}
resource "aws_iam_role_policy_attachment" "lambda_summary_policy" {
  role       = aws_iam_role.lambda_summary_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}
resource "aws_lambda_function" "transcribe_summary" {

  function_name = "healthcare-io-transcribe-summary"
  role          = aws_iam_role.lambda_summary_role.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.summary_repo.repository_url}:latest"
  timeout       = 300
  memory_size   = 512
  architectures = ["arm64"]
  lifecycle {
    create_before_destroy = true
  }

  depends_on = [aws_ecr_repository.summary_repo]
}
resource "aws_lambda_permission" "allow_s3_invoke_transcribe_summary" {
  statement_id  = "AllowExecutionFromS3Summary"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.transcribe_summary.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.transcribe_result.arn
}
resource "aws_s3_bucket_notification" "transcribe_result_lambda_trigger" {
  bucket = aws_s3_bucket.transcribe_result.id
  lambda_function {
    lambda_function_arn = aws_lambda_function.transcribe_summary.arn
    events              = ["s3:ObjectCreated:*"]
  }
  depends_on = [aws_lambda_permission.allow_s3_invoke_transcribe_summary]
}
resource "aws_iam_role_policy" "lambda_summary_bedrock_policy" {
  name = "healthcare-io-transcribe-summary-bedrock-policy"
  role = aws_iam_role.lambda_summary_role.id

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Action = [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
          "bedrock:ListFoundationModels"
        ],
        Resource = "*"
      },
      {
        Effect = "Allow",
        Action = [
          "s3:GetObject",
          "s3:PutObject"
        ],
        Resource = [
          "arn:aws:s3:::healthcare-io-transcribe-result/*"
        ]
      }
    ]
  })
}