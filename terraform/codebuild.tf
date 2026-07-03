resource "aws_codebuild_project" "worker" {
  name         = "${var.project}-worker"
  service_role = aws_iam_role.codebuild.arn

  source {
    type      = "S3"
    location  = "${aws_s3_bucket.builds.bucket}/"
    buildspec = file("${path.module}/buildspec.yml")
  }

  artifacts {
    type = "NO_ARTIFACTS"
  }

  environment {
    compute_type                = "BUILD_GENERAL1_SMALL"
    image                       = "aws/codebuild/standard:7.0"
    type                        = "LINUX_CONTAINER"
    privileged_mode             = true
    image_pull_credentials_type = "CODEBUILD"

    environment_variable {
      name  = "ECR_REPO"
      value = aws_ecr_repository.worker.repository_url
    }

    environment_variable {
      name  = "BASE_IMAGE"
      value = "${aws_ecr_repository.base.repository_url}:latest"
    }

    environment_variable {
      name  = "AWS_ACCOUNT_ID"
      value = data.aws_caller_identity.current.account_id
    }

    environment_variable {
      name  = "AWS_DEFAULT_REGION"
      value = var.region
    }
  }

  logs_config {
    cloudwatch_logs {
      group_name = "/${var.project}/codebuild"
    }
  }

  tags = { Project = var.project }
}
