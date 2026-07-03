resource "aws_ecr_repository" "base" {
  name                 = "${var.project}-base"
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  tags = { Project = var.project }
}

resource "aws_ecr_repository" "worker" {
  name                 = "${var.project}-worker"
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  tags = { Project = var.project }
}
