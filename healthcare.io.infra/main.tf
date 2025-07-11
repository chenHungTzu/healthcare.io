terraform {
  required_version = ">= 1.3.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }

  }
  backend "s3" {
    bucket         = "tf-bucket-0305"
    key            = "healthcare.io.infra/terraform.tfstate"
    region         = "ap-northeast-1"
    dynamodb_table = "tflock"
  }
}
data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

resource "null_resource" "ecr_login" {
  provisioner "local-exec" {
    command = <<EOF
          aws ecr get-login-password --region ${data.aws_region.current.name} | docker login --username AWS --password-stdin ${data.aws_caller_identity.current.account_id}.dkr.ecr.${data.aws_region.current.name}.amazonaws.com
          EOF
  }

  triggers = {
    always_run = timestamp()
  }
}
