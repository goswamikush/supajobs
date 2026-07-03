resource "aws_dynamodb_table" "projects" {
  name         = "${var.project}-projects"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "projectKey"

  attribute {
    name = "projectKey"
    type = "S"
  }

  tags = { Project = var.project }
}
