variable "subscription_id" { type = string }
variable "environment" {
  type = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging or prod."
  }
}
variable "location" {
  type        = string
  default     = "qatarcentral"
  description = "Must stay in-country (PDPPL, ADR-002/006). Changing it needs an ADR and counsel sign-off."
  validation {
    condition     = var.location == "qatarcentral"
    error_message = "Data must stay in Qatar: location must be qatarcentral (see ADR-006). Amend the plan + legal basis before changing."
  }
}
variable "address_space" {
  type    = string
  default = "10.40.0.0/16"
}
variable "availability_zones" {
  type        = list(string)
  default     = []
  description = "e.g. [\"1\",\"2\",\"3\"] ONLY if Qatar Central offers zones for every service used (step 9.0 result)."
}
variable "zone_redundant" {
  type    = bool
  default = false
}

# data
variable "postgres_sku" {
  type    = string
  default = "B_Standard_B1ms"
}
variable "postgres_storage_mb" {
  type    = number
  default = 32768
}
variable "postgres_ha_mode" {
  type    = string
  default = "Disabled"
}
variable "postgres_backup_retention_days" {
  type    = number
  default = 7
}

# security / access
variable "key_vault_allowed_ips" {
  type    = list(string)
  default = []
}
variable "admin_allowed_cidrs" {
  type        = list(string)
  description = "Office/VPN ranges for the admin console. Required; never 0.0.0.0/0."
  validation {
    condition     = length(var.admin_allowed_cidrs) > 0 && !contains(var.admin_allowed_cidrs, "0.0.0.0/0")
    error_message = "admin_allowed_cidrs must be non-empty and must not contain 0.0.0.0/0."
  }
}

# observability
variable "alert_emails" { type = list(string) }
variable "alert_webhook_url" {
  type      = string
  default   = ""
  sensitive = true
}
variable "log_retention_days" {
  type    = number
  default = 30
}
variable "monthly_budget" {
  type    = number
  default = 900
}

# apps
variable "web_min_replicas" {
  type    = number
  default = 1
}
variable "web_max_replicas" {
  type    = number
  default = 4
}
variable "api_min_replicas" {
  type    = number
  default = 1
}
variable "api_max_replicas" {
  type    = number
  default = 4
}
variable "legal_email" {
  type    = string
  default = "legal@example.qa"
}
variable "mail_from" {
  type    = string
  default = "Qarib <no-reply@example.qa>"
}
variable "smtp_host" {
  type    = string
  default = "smtp.example.qa"
}
variable "ingest_user_agent" {
  type    = string
  default = "QaribBot/1.0 (+https://example.qa/bot; legal@example.qa)"
}

# edge + dns
variable "public_hostname" {
  type        = string
  description = "e.g. example.qa (prod) or staging.example.qa"
}
variable "admin_hostname" {
  type        = string
  description = "e.g. admin.example.qa"
}
variable "enable_edge" {
  type    = bool
  default = false
}
variable "tls_certificate_secret_id" {
  type    = string
  default = ""
}
variable "waf_mode" {
  type    = string
  default = "Prevention"
}
variable "manage_dns" {
  type    = bool
  default = false
}
variable "dns_zone_name" {
  type    = string
  default = ""
}

variable "site_indexing" {
  type        = string
  default     = "on"
  description = "Set to \"off\" for the soft launch (plan 10.6): keeps the site out of search engines until day 14."
  validation {
    condition     = contains(["on", "off"], var.site_indexing)
    error_message = "site_indexing must be \"on\" or \"off\"."
  }
}
