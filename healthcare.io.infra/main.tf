terraform {
  required_version = ">= 1.3.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
    awscc = {
      source  = "hashicorp/awscc"
      version = ">= 0.62.0"
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
