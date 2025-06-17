resource "aws_iam_role" "bedrock_execution_role" {
  name = "AmazonBedrockExecutionRoleForKnowledgeBase"

  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect = "Allow",
      Principal = {
        Service = "bedrock.amazonaws.com"
      },
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_policy" "custom_policy_1" {
  name = "bedrock-custom-access-policy-1"

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Sid    = "S3ListBucketStatement",
        Effect = "Allow",
        Action = ["s3:ListBucket"],
        Resource = [
          "${aws_s3_bucket.transcribe_result.arn}",
          "${aws_s3_bucket.knowledge_base_distinct.arn}"
        ],
        Condition = {
          StringEquals = {
            "aws:ResourceAccount" = ["${data.aws_caller_identity.current.account_id}"]
          }
        }
      },
      {
        Sid    = "S3GetObjectStatement",
        Effect = "Allow",
        Action = ["s3:GetObject"],
        Resource = [
          "${aws_s3_bucket.transcribe_result.arn}/summary-result/*",
          "${aws_s3_bucket.knowledge_base_distinct.arn}/*"
        ]
        Condition = {
          StringEquals = {
            "aws:ResourceAccount" = ["${data.aws_caller_identity.current.account_id}"]
          }
        }
      },
      {
        Sid    = "S3PutObjectStatement",
        Effect = "Allow",
        Action = [
          "s3:PutObject",
          "s3:DeleteObject"
        ],
        Resource = [
          "${aws_s3_bucket.knowledge_base_distinct.arn}/*"
        ]
      },
      {
        Sid      = "BedrockInvokeModelStatement",
        Effect   = "Allow",
        Action   = ["bedrock:InvokeModel"],
        Resource = ["arn:aws:bedrock:ap-northeast-1::foundation-model/anthropic.claude-3-5-sonnet-20240620-v1:0"]
      }
    ]
  })
}

resource "aws_iam_policy" "custom_policy_2" {
  name = "bedrock-custom-access-policy-2"

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Sid      = "BedrockInvokeModelStatement",
        Effect   = "Allow",
        Action   = ["bedrock:InvokeModel"],
        Resource = ["arn:aws:bedrock:ap-northeast-1::foundation-model/amazon.titan-embed-text-v1"]
      },
      {
        Sid    = "RdsDescribeStatementID",
        Effect = "Allow",
        Action = ["rds:DescribeDBClusters"],
        Resource = [
        aws_rds_cluster.aurora_cluster.arn]
      },
      {
        Sid    = "DataAPIStatementID",
        Effect = "Allow",
        Action = [
          "rds-data:ExecuteStatement",
          "rds-data:BatchExecuteStatement"
        ],
        Resource = [aws_rds_cluster.aurora_cluster.arn]
      },
      {
        Sid      = "SecretsManagerGetStatement",
        Effect   = "Allow",
        Action   = ["secretsmanager:GetSecretValue"],
        Resource = [aws_secretsmanager_secret.aurora_secret.arn]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "attach_policy_1" {
  role       = aws_iam_role.bedrock_execution_role.name
  policy_arn = aws_iam_policy.custom_policy_1.arn
}

resource "aws_iam_role_policy_attachment" "attach_policy_2" {
  role       = aws_iam_role.bedrock_execution_role.name
  policy_arn = aws_iam_policy.custom_policy_2.arn
}


resource "aws_iam_role" "bedrock_execution_agent_role" {
  name = "AmazonBedrockExecutionRoleForAgent"
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect = "Allow",
      Principal = {
        Service = "bedrock.amazonaws.com"
      },
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_policy" "custom_policy_3" {
  name = "bedrock-custom-access-policy-3"

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        "Sid" : "AmazonBedrockAgentBedrockFoundationModelPolicyProd",
        "Effect" : "Allow",
        "Action" : [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream"
        ],
        "Resource" : [
          "arn:aws:bedrock:ap-northeast-1::foundation-model/amazon.nova-lite-v1:0",
          "arn:aws:bedrock:ap-northeast-1::foundation-model/anthropic.claude-3-5-sonnet-20240620-v1:0"
        ]
      }
    ]
  })
}



resource "aws_iam_policy" "custom_policy_4" {
  name = "bedrock-custom-access-policy-4"
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        "Sid" : "AmazonBedrockAgentRetrieveKnowledgeBasePolicyProd",
        "Effect" : "Allow",
        "Action" : [
          "bedrock:Retrieve"
        ],
        "Resource" : [
          "${aws_bedrockagent_knowledge_base.healthcare_kb.arn}"
        ]
      }
    ]
  })
}


resource "aws_iam_role_policy_attachment" "attach_policy_3" {
  role       = aws_iam_role.bedrock_execution_agent_role.name
  policy_arn = aws_iam_policy.custom_policy_3.arn
}

resource "aws_iam_role_policy_attachment" "attach_policy_4" {
  role       = aws_iam_role.bedrock_execution_agent_role.name
  policy_arn = aws_iam_policy.custom_policy_4.arn
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "private_a" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.1.0/24"
  availability_zone = "ap-northeast-1a"
}

resource "aws_subnet" "private_b" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.2.0/24"
  availability_zone = "ap-northeast-1c"
}

resource "aws_db_subnet_group" "main" {
  name       = "aurora-subnet-group"
  subnet_ids = [aws_subnet.private_a.id, aws_subnet.private_b.id]
}

resource "aws_secretsmanager_secret" "aurora_secret" {
  name = "BedrockUserSecret"
}

resource "aws_secretsmanager_secret_version" "aurora_secret_value" {
  secret_id = aws_secretsmanager_secret.aurora_secret.id
  secret_string = jsonencode({
    username = "bedrock_user"
    password = "YourStrongPassword123!"
  })
}

resource "aws_rds_cluster" "aurora_cluster" {
  cluster_identifier      = "healthcare-kb-aurora-cluster"
  engine                  = "aurora-postgresql"
  engine_version          = "16.6"        # 指定支援 Serverless v2 的版本
  engine_mode             = "provisioned" # Use "serverless" if v2 supported
  database_name           = "healthcare_db"
  master_username         = jsondecode(aws_secretsmanager_secret_version.aurora_secret_value.secret_string)["username"]
  master_password         = jsondecode(aws_secretsmanager_secret_version.aurora_secret_value.secret_string)["password"]
  skip_final_snapshot     = true
  db_subnet_group_name    = aws_db_subnet_group.main.name
  backup_retention_period = 1
  preferred_backup_window = "07:00-09:00"
  enable_http_endpoint    = true

  serverlessv2_scaling_configuration {
    max_capacity = 1.0
    min_capacity = 0.5
  }

}

resource "aws_rds_cluster_instance" "aurora_instance" {
  identifier         = "aurora-instance-1"
  cluster_identifier = aws_rds_cluster.aurora_cluster.id
  instance_class     = "db.serverless"
  engine             = aws_rds_cluster.aurora_cluster.engine
}

# Execute Aurora database cleanup before creating knowledge base
# This will only run once when the resource is first created
resource "null_resource" "aurora_db_init" {
  # Use a static trigger that only changes when we actually want to re-run the script
  triggers = {
    # Only trigger on the cluster identifier (stable) and a manual version
    cluster_id     = aws_rds_cluster.aurora_cluster.cluster_identifier
    script_version = "v1.0" # Change this manually if you need to re-run the script
  }

  provisioner "local-exec" {
    command     = "./cleanup_aurora_db.sh"
    working_dir = path.module
  }

  depends_on = [
    aws_rds_cluster_instance.aurora_instance,
    aws_secretsmanager_secret_version.aurora_secret_value
  ]
}

resource "aws_bedrockagent_knowledge_base" "healthcare_kb" {
  name     = "healthcare-knowledgebase"
  role_arn = aws_iam_role.bedrock_execution_role.arn
  knowledge_base_configuration {
    vector_knowledge_base_configuration {
      embedding_model_arn = "arn:aws:bedrock:ap-northeast-1::foundation-model/amazon.titan-embed-text-v1"

      supplemental_data_storage_configuration {
        storage_location {
          type = "S3"

          s3_location {
            uri = "s3://${aws_s3_bucket.knowledge_base_distinct.bucket}"
          }

        }
      }
    }
    type = "VECTOR"
  }
  storage_configuration {
    type = "RDS"
    rds_configuration {
      credentials_secret_arn = aws_secretsmanager_secret.aurora_secret.arn
      database_name          = aws_rds_cluster.aurora_cluster.database_name
      resource_arn           = aws_rds_cluster.aurora_cluster.arn
      table_name             = "knowledge_base_table"
      field_mapping {
        vector_field      = "embedding"
        text_field        = "chunks"
        metadata_field    = "metadata"
        primary_key_field = "id"

      }

    }
  }

  depends_on = [
    null_resource.aurora_db_init,
    aws_iam_role_policy_attachment.attach_policy_1,
    aws_iam_role_policy_attachment.attach_policy_2,
    aws_s3_bucket.knowledge_base_distinct,
    aws_s3_bucket.transcribe_result
  ]
}

resource "aws_bedrockagent_data_source" "healthcare_summary_data_source" {
  knowledge_base_id = aws_bedrockagent_knowledge_base.healthcare_kb.id
  name              = "healthcare-summary"
  data_source_configuration {
    type = "S3"
    s3_configuration {
      bucket_arn         = aws_s3_bucket.transcribe_result.arn
      inclusion_prefixes = ["summary-result/"]
    }
  }
}

resource "aws_bedrockagent_agent" "healthcare_assistant" {
  agent_name              = "healthcare-assistant"
  agent_resource_role_arn = aws_iam_role.bedrock_execution_agent_role.arn
  foundation_model        = "amazon.nova-lite-v1:0"
  description             = "Healthcare doctor agent for medical transcription analysis"
  instruction             = "You are a healthcare doctor. Your task is to answer questions based on the provided knowledge base and any additional context given by the user. If you do not know the answer, respond with 'I don't know'."
}

resource "aws_bedrockagent_agent_knowledge_base_association" "healthcare_kb_association" {
  agent_id             = aws_bedrockagent_agent.healthcare_assistant.agent_id
  description          = "Associate healthcare knowledge base with agent"
  knowledge_base_id    = aws_bedrockagent_knowledge_base.healthcare_kb.id
  knowledge_base_state = "ENABLED"
}

resource "aws_bedrockagent_agent_alias" "healthcare_assistant_alias" {
  agent_alias_name = "healthcare-assistant-alias"
  agent_id         = aws_bedrockagent_agent.healthcare_assistant.agent_id
  description      = "Alias for the healthcare doctor agent"

}

