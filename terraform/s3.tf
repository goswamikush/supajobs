resource "aws_s3_bucket" "builds" {
  bucket        = "${var.project}-builds-${data.aws_caller_identity.current.account_id}"
  force_destroy = true

  tags = { Project = var.project }
}

resource "aws_s3_bucket_lifecycle_configuration" "builds" {
  bucket = aws_s3_bucket.builds.id

  rule {
    id     = "delete-old-builds"
    status = "Enabled"

    filter {}

    expiration {
      days = 1
    }
  }
}
