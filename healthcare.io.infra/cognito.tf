resource "aws_cognito_identity_pool" "anonymous_patient_idp" {
  identity_pool_name               = "anonymous_patient_idp"
  allow_unauthenticated_identities = true
  allow_classic_flow               = true
}


resource "aws_iam_role" "kvs_sts_role" {
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        "Effect" : "Allow",
        "Principal" : {
          "Federated" : "cognito-identity.amazonaws.com"
        },
        "Action" : "sts:AssumeRoleWithWebIdentity",
        "Condition" : {
          "StringEquals" : {
            "cognito-identity.amazonaws.com:aud" : "${aws_cognito_identity_pool.anonymous_patient_idp.id}"
          },
          "ForAnyValue:StringLike" : {
            "cognito-identity.amazonaws.com:amr" : "unauthenticated"
          }
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "kvs_sts_role_policy" {
  role = aws_iam_role.kvs_sts_role.name

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        "Sid" : "VisualEditor0",
        "Effect" : "Allow",
        "Action" : [
          "kinesisvideo:Describe*",
          "kinesisvideo:Get*",
          "kinesisvideo:List*",
          "kinesisvideo:Connect*",
          "kinesisvideo:JoinStorageSession",
          "kinesisvideo:JoinStorageSessionAsViewer"
        ],
        "Resource" : "${awscc_kinesisvideo_signaling_channel.provider_channel.arn}"
      },
      {
        Effect = "Allow",
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ],
        Resource = [
          "${aws_s3_bucket.audio.arn}",
          "${aws_s3_bucket.audio.arn}/*"
        ]
      },
    ],
  })
}
