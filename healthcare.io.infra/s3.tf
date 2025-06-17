resource "aws_s3_bucket" "audio" {
  bucket        = "healthcare-io-audio"
  force_destroy = true
  tags = {
    Name = "healthcare-io-audio"
  }
}

resource "aws_s3_bucket" "transcribe_result" {
  bucket        = "healthcare-io-transcribe-result"
  force_destroy = true
  tags = {
    Name = "healthcare-io-transcribe-result"
  }
}


resource "aws_s3_bucket" "knowledge_base_distinct" {
  bucket        = "healthcare-io-knowledge-base-distinct"
  force_destroy = true
  tags = {
    Name = "healthcare-io-knowledge-base-distinct"
  }
}
