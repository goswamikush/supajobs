data "archive_file" "lambda_placeholder" {
  type        = "zip"
  output_path = "${path.module}/.terraform/lambda-placeholder.zip"

  source {
    content  = "exports.handler = async () => ({ statusCode: 200, body: 'ok' });"
    filename = "index.js"
  }
}

resource "aws_lambda_function" "trigger" {
  function_name = "${var.project}-trigger"
  role          = aws_iam_role.lambda.arn
  handler       = "lambda/index.handler"
  runtime       = "nodejs20.x"
  timeout       = 30
  memory_size   = 256

  filename         = data.archive_file.lambda_placeholder.output_path
  source_code_hash = data.archive_file.lambda_placeholder.output_base64sha256

  environment {
    variables = {
      PROJECTS_TABLE      = aws_dynamodb_table.projects.name
      ECS_CLUSTER         = aws_ecs_cluster.main.name
      ECS_TASK_DEFINITION = aws_ecs_task_definition.worker.family
      ECS_SUBNETS         = join(",", data.aws_subnets.default.ids)
      ECS_SECURITY_GROUP  = aws_security_group.worker.id
      ECR_WORKER_REPO     = aws_ecr_repository.worker.repository_url
    }
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = { Project = var.project }
}
