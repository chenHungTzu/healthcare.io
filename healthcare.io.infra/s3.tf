resource "aws_s3_bucket" "audio" {
  bucket        = "healthcare-io-audio"
  force_destroy = true
  tags = {
    Name = "healthcare-io-audio"
  }

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "POST", "DELETE"]
    allowed_origins = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

resource "aws_s3_bucket" "transcribe_result" {
  bucket        = "healthcare-io-transcribe-result"
  force_destroy = true
  tags = {
    Name = "healthcare-io-transcribe-result"
  }

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "POST", "DELETE"]
    allowed_origins = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}


resource "aws_s3_bucket" "knowledge_base_distinct" {
  bucket        = "healthcare-io-knowledge-base-distinct"
  force_destroy = true
  tags = {
    Name = "healthcare-io-knowledge-base-distinct"
  }

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "POST", "DELETE"]
    allowed_origins = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}
