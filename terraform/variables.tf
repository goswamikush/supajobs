variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Project name used to namespace all resources"
  type        = string
  default     = "supajobs"
}

variable "worker_cpu" {
  description = "Fargate task CPU units (256 = 0.25 vCPU)"
  type        = number
  default     = 256
}

variable "worker_memory" {
  description = "Fargate task memory in MB"
  type        = number
  default     = 512
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 7
}

variable "invite_codes" {
  description = "Comma-separated invite codes required to register a project via /init during the waitlist rollout. Set via terraform.tfvars (gitignored) or TF_VAR_invite_codes."
  type        = string
  default     = ""
  sensitive   = true
}

variable "budget_amount" {
  description = "Monthly USD threshold for the account cost budget alert."
  type        = string
  default     = "50"
}

variable "budget_notification_email" {
  description = "Email address to notify when spend approaches/exceeds budget_amount. Set via terraform.tfvars (gitignored) or TF_VAR_budget_notification_email."
  type        = string
  default     = ""
  sensitive   = true
}
