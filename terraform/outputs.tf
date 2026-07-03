output "api_url" {
  description = "API Gateway invoke URL"
  value       = trimsuffix(aws_apigatewayv2_stage.default.invoke_url, "/")
}

output "ecr_repository_url" {
  value = aws_ecr_repository.worker.repository_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "dynamodb_table_name" {
  value = aws_dynamodb_table.projects.name
}

output "s3_builds_bucket" {
  value = aws_s3_bucket.builds.bucket
}

output "codebuild_project_name" {
  value = aws_codebuild_project.worker.name
}

output "lambda_function_name" {
  value = aws_lambda_function.trigger.function_name
}
