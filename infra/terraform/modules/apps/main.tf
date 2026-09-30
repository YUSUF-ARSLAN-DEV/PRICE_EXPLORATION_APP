variable "name" { type = string }
variable "location" { type = string }
variable "resource_group_name" { type = string }
variable "tags" {
  type    = map(string)
  default = {}
}

variable "apps_subnet_id" { type = string }
variable "log_analytics_workspace_id" { type = string }
variable "zone_redundant" {
  type    = bool
  default = false
}

variable "acr_login_server" { type = string }
variable "key_vault_uri" { type = string }
variable "identity_api_id" { type = string }
variable "identity_web_id" { type = string }
variable "identity_worker_id" { type = string }
variable "storage_blob_endpoint" { type = string }

variable "secret_ids" {
  description = "Versionless Key Vault secret ids consumed by the workloads."
  type = object({
    jwt               = string
    meili             = string
    database_api      = string
    database_worker   = string
    database_migrator = string
  })
}
variable "role_password_secret_ids" {
  description = "Key Vault secret ids with the passwords for the least-privilege DB roles (used by the roles job)."
  type = object({
    api      = string
    worker   = string
    readonly = string
  })
}

variable "image_tag" {
  type        = string
  default     = "bootstrap"
  description = "Initial tag. Releases are rolled out by the deploy pipeline (az containerapp update), not by Terraform."
}
variable "public_hostname" { type = string }
variable "admin_hostname" { type = string }
variable "gateway_public_ip" {
  type        = string
  description = "Only the Application Gateway may reach the public apps (ingress IP restriction)."
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
  type        = string
  default     = "smtp.example.qa"
  description = "Approved transactional email relay (docs/legal/subprocessors.md)."
}
variable "smtp_port" {
  type    = number
  default = 587
}
variable "ingest_user_agent" {
  type    = string
  default = "QaribBot/1.0 (+https://example.qa/bot; legal@example.qa)"
}

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

locals {
  image = { for n in ["api", "web", "admin", "ingest", "matcher"] : n => "${var.acr_login_server}/qarib-${n}:${var.image_tag}" }
  # API listens on 4000 and is reachable only inside the environment (web proxies /api/v1 to it).
  api_internal_url = "http://ca-${var.name}-api/v1"
  site_url         = "https://${var.public_hostname}"
}

resource "azurerm_container_app_environment" "this" {
  name                           = "cae-${var.name}"
  location                       = var.location
  resource_group_name            = var.resource_group_name
  log_analytics_workspace_id     = var.log_analytics_workspace_id
  infrastructure_subnet_id       = var.apps_subnet_id
  internal_load_balancer_enabled = false
  zone_redundancy_enabled        = var.zone_redundant
  tags                           = var.tags

  workload_profile {
    name                  = "Consumption"
    workload_profile_type = "Consumption"
  }
}

# ---------------------------------------------------------------------------- API (internal)
resource "azurerm_container_app" "api" {
  name                         = "ca-${var.name}-api"
  container_app_environment_id = azurerm_container_app_environment.this.id
  resource_group_name          = var.resource_group_name
  revision_mode                = "Multiple" # canary: two revisions with a traffic split (deploy pipeline)
  workload_profile_name        = "Consumption"
  tags                         = var.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [var.identity_api_id]
  }
  registry {
    server   = var.acr_login_server
    identity = var.identity_api_id
  }
  secret {
    name                = "jwt-secret"
    key_vault_secret_id = var.secret_ids.jwt
    identity            = var.identity_api_id
  }
  secret {
    name                = "database-url"
    key_vault_secret_id = var.secret_ids.database_api
    identity            = var.identity_api_id
  }
  secret {
    name                = "meili-key"
    key_vault_secret_id = var.secret_ids.meili
    identity            = var.identity_api_id
  }

  ingress {
    external_enabled = false
    target_port      = 4000
    transport        = "http"
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = var.api_min_replicas
    max_replicas = var.api_max_replicas

    http_scale_rule {
      name                = "http"
      concurrent_requests = "80"
    }

    container {
      name   = "api"
      image  = local.image.api
      cpu    = 0.5
      memory = "1Gi"

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "API_PORT"
        value = "4000"
      }
      env {
        name        = "DATABASE_URL"
        secret_name = "database-url"
      }
      env {
        name        = "JWT_SECRET"
        secret_name = "jwt-secret"
      }
      env {
        name  = "APP_URL"
        value = local.site_url
      }
      env {
        name  = "ADMIN_URL"
        value = "https://${var.admin_hostname}"
      }
      env {
        name  = "REFRESH_COOKIE_PATH"
        value = "/api/v1/auth"
      }
      env {
        # client -> Application Gateway -> web (runtime proxy) -> API: X-Forwarded-For carries the client
        name  = "TRUST_PROXY_HOPS"
        value = "1"
      }
      env {
        name  = "SMTP_HOST"
        value = var.smtp_host
      }
      env {
        name  = "SMTP_PORT"
        value = tostring(var.smtp_port)
      }
      env {
        name  = "MAIL_FROM"
        value = var.mail_from
      }
      env {
        name  = "LEGAL_EMAIL"
        value = var.legal_email
      }
      env {
        name  = "MEILI_URL"
        value = "http://ca-${var.name}-meili:7700"
      }
      env {
        name        = "MEILI_MASTER_KEY"
        secret_name = "meili-key"
      }
      env {
        name  = "AZURE_STORAGE_ACCOUNT_URL"
        value = var.storage_blob_endpoint
      }
      env {
        name  = "AZURE_CLIENT_ID"
        value = "" # set by the pipeline to the api identity client id (DefaultAzureCredential)
      }
      env {
        name  = "CLAMAV_HOST"
        value = "ca-${var.name}-clamav"
      }

      startup_probe {
        transport               = "HTTP"
        port                    = 4000
        path                    = "/v1/health"
        initial_delay           = 3
        interval_seconds        = 5
        failure_count_threshold = 12
      }
      liveness_probe {
        transport        = "HTTP"
        port             = 4000
        path             = "/v1/health"
        interval_seconds = 20
      }
      readiness_probe {
        transport        = "HTTP"
        port             = 4000
        path             = "/v1/health"
        interval_seconds = 10
      }
    }
  }

  lifecycle {
    # The deploy pipeline owns the image and the canary traffic split.
    ignore_changes = [template[0].container[0].image, ingress[0].traffic_weight, template[0].container[0].env]
  }
}

# ---------------------------------------------------------------------------- ClamAV (internal)
resource "azurerm_container_app" "clamav" {
  name                         = "ca-${var.name}-clamav"
  container_app_environment_id = azurerm_container_app_environment.this.id
  resource_group_name          = var.resource_group_name
  revision_mode                = "Single"
  workload_profile_name        = "Consumption"
  tags                         = var.tags

  ingress {
    external_enabled = false
    target_port      = 3310
    transport        = "tcp"
    exposed_port     = 3310
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = 1
    max_replicas = 1
    container {
      name = "clamav"
      # Mirror into the private registry (az acr import) and pin a digest before production.
      image  = "docker.io/clamav/clamav:1.4"
      cpu    = 1
      memory = "3Gi"
    }
  }
}

# ---------------------------------------------------------------------------- Meilisearch (internal)
resource "azurerm_container_app" "meili" {
  name                         = "ca-${var.name}-meili"
  container_app_environment_id = azurerm_container_app_environment.this.id
  resource_group_name          = var.resource_group_name
  revision_mode                = "Single"
  workload_profile_name        = "Consumption"
  tags                         = var.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [var.identity_api_id]
  }
  secret {
    name                = "meili-key"
    key_vault_secret_id = var.secret_ids.meili
    identity            = var.identity_api_id
  }

  ingress {
    external_enabled = false
    target_port      = 7700
    transport        = "http"
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    # One replica with scratch storage: the index is rebuilt from public_products by the `reindex`
    # job (on start-up and every 30 min), so losing it only costs a few seconds of degraded search
    # (the API falls back to Postgres). Do not scale out without a shared index.
    min_replicas = 1
    max_replicas = 1
    container {
      name   = "meilisearch"
      image  = "docker.io/getmeili/meilisearch:v1.11"
      cpu    = 0.5
      memory = "1Gi"
      env {
        name        = "MEILI_MASTER_KEY"
        secret_name = "meili-key"
      }
      env {
        name  = "MEILI_ENV"
        value = "production"
      }
      env {
        name  = "MEILI_NO_ANALYTICS"
        value = "true"
      }
    }
  }
}

# ---------------------------------------------------------------------------- Web (public, via gateway)
resource "azurerm_container_app" "web" {
  name                         = "ca-${var.name}-web"
  container_app_environment_id = azurerm_container_app_environment.this.id
  resource_group_name          = var.resource_group_name
  revision_mode                = "Multiple"
  workload_profile_name        = "Consumption"
  tags                         = var.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [var.identity_web_id]
  }
  registry {
    server   = var.acr_login_server
    identity = var.identity_web_id
  }

  ingress {
    external_enabled = true
    target_port      = 3000
    transport        = "http"
    ip_security_restriction {
      name             = "application-gateway-only"
      action           = "Allow"
      ip_address_range = "${var.gateway_public_ip}/32"
    }
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = var.web_min_replicas
    max_replicas = var.web_max_replicas
    http_scale_rule {
      name                = "http"
      concurrent_requests = "100"
    }
    container {
      name   = "web"
      image  = local.image.web
      cpu    = 0.5
      memory = "1Gi"
      env {
        name  = "API_URL"
        value = local.api_internal_url
      }
      env {
        name  = "PORT"
        value = "3000"
      }
      liveness_probe {
        transport        = "HTTP"
        port             = 3000
        path             = "/en"
        interval_seconds = 20
      }
      readiness_probe {
        transport        = "HTTP"
        port             = 3000
        path             = "/en"
        interval_seconds = 10
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].container[0].image, ingress[0].traffic_weight]
  }
}

# ---------------------------------------------------------------------------- Admin (gateway + allow-list + SSO)
resource "azurerm_container_app" "admin" {
  name                         = "ca-${var.name}-admin"
  container_app_environment_id = azurerm_container_app_environment.this.id
  resource_group_name          = var.resource_group_name
  revision_mode                = "Single"
  workload_profile_name        = "Consumption"
  tags                         = var.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [var.identity_web_id]
  }
  registry {
    server   = var.acr_login_server
    identity = var.identity_web_id
  }

  ingress {
    external_enabled = true
    target_port      = 3001
    transport        = "http"
    ip_security_restriction {
      name             = "application-gateway-only"
      action           = "Allow"
      ip_address_range = "${var.gateway_public_ip}/32"
    }
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = 1
    max_replicas = 2
    container {
      name   = "admin"
      image  = local.image.admin
      cpu    = 0.25
      memory = "0.5Gi"
      env {
        name  = "API_URL"
        value = local.api_internal_url
      }
      env {
        name  = "PORT"
        value = "3001"
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].container[0].image]
  }
}

# ---------------------------------------------------------------------------- Jobs
locals {
  # Shared env for the API image used as a job runner.
  api_job_env = {
    NODE_ENV                  = "production"
    APP_URL                   = local.site_url
    SMTP_HOST                 = var.smtp_host
    SMTP_PORT                 = tostring(var.smtp_port)
    MAIL_FROM                 = var.mail_from
    MEILI_URL                 = "http://ca-${var.name}-meili:7700"
    AZURE_STORAGE_ACCOUNT_URL = var.storage_blob_endpoint
    AZURE_RECEIPT_CONTAINER   = "receipts"
  }

  # name => { cron (null = manual), image key, command, identity, secrets }
  jobs = {
    migrate = {
      cron     = null
      image    = "api"
      command  = ["sh", "-c", "node ../../packages/db/dist/cli.js up && node ../../packages/db/dist/cli.js roles"]
      identity = var.identity_api_id
      kind     = "migrator"
    }
    alerts = {
      cron     = "*/15 * * * *"
      image    = "api"
      command  = ["node", "dist/jobs/run.js", "alerts"]
      identity = var.identity_api_id
      kind     = "api"
    }
    maintenance-api = {
      cron     = "30 1 * * *"
      image    = "api"
      command  = ["node", "dist/jobs/run.js", "maintenance"]
      identity = var.identity_api_id
      kind     = "api"
    }
    reindex = {
      cron     = "*/30 * * * *"
      image    = "api"
      command  = ["node", "dist/jobs/run.js", "reindex"]
      identity = var.identity_api_id
      kind     = "api"
    }
    freshness = {
      cron     = "*/30 * * * *"
      image    = "api"
      command  = ["node", "dist/jobs/run.js", "freshness"]
      identity = var.identity_api_id
      kind     = "api"
    }
    maintenance-ingest = {
      cron     = "0 1 * * *"
      image    = "ingest"
      command  = ["qarib-ingest", "maintenance"]
      identity = var.identity_worker_id
      kind     = "worker"
    }
    matcher = {
      cron     = "15 * * * *"
      image    = "matcher"
      command  = ["qarib-match", "run"]
      identity = var.identity_worker_id
      kind     = "worker"
    }
  }
}

resource "azurerm_container_app_job" "this" {
  for_each                     = local.jobs
  name                         = "caj-${var.name}-${each.key}"
  location                     = var.location
  resource_group_name          = var.resource_group_name
  container_app_environment_id = azurerm_container_app_environment.this.id
  workload_profile_name        = "Consumption"
  replica_timeout_in_seconds   = 1800
  replica_retry_limit          = each.value.cron == null ? 0 : 1
  tags                         = var.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [each.value.identity]
  }
  registry {
    server   = var.acr_login_server
    identity = each.value.identity
  }

  dynamic "manual_trigger_config" {
    for_each = each.value.cron == null ? [1] : []
    content {
      parallelism              = 1
      replica_completion_count = 1
    }
  }
  dynamic "schedule_trigger_config" {
    for_each = each.value.cron == null ? [] : [1]
    content {
      cron_expression          = each.value.cron
      parallelism              = 1
      replica_completion_count = 1
    }
  }

  secret {
    name                = "database-url"
    key_vault_secret_id = each.value.kind == "migrator" ? var.secret_ids.database_migrator : (each.value.kind == "worker" ? var.secret_ids.database_worker : var.secret_ids.database_api)
    identity            = each.value.identity
  }
  dynamic "secret" {
    for_each = each.value.kind == "migrator" ? { api = var.role_password_secret_ids.api, worker = var.role_password_secret_ids.worker, readonly = var.role_password_secret_ids.readonly } : {}
    content {
      name                = "role-pw-${secret.key}"
      key_vault_secret_id = secret.value
      identity            = each.value.identity
    }
  }
  dynamic "secret" {
    for_each = each.value.kind == "api" ? { jwt = var.secret_ids.jwt, meili = var.secret_ids.meili } : {}
    content {
      name                = secret.key == "jwt" ? "jwt-secret" : "meili-key"
      key_vault_secret_id = secret.value
      identity            = each.value.identity
    }
  }

  template {
    container {
      name    = each.key
      image   = local.image[each.value.image]
      command = each.value.command
      cpu     = 0.5
      memory  = "1Gi"

      env {
        name        = "DATABASE_URL"
        secret_name = "database-url"
      }
      env {
        name  = "INGEST_USER_AGENT"
        value = var.ingest_user_agent
      }
      dynamic "env" {
        for_each = each.value.kind == "api" ? local.api_job_env : {}
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = each.value.kind == "api" ? { JWT_SECRET = "jwt-secret", MEILI_MASTER_KEY = "meili-key" } : {}
        content {
          name        = env.key
          secret_name = env.value
        }
      }
      dynamic "env" {
        for_each = each.value.kind == "migrator" ? { QARIB_API_DB_PASSWORD = "role-pw-api", QARIB_WORKER_DB_PASSWORD = "role-pw-worker", QARIB_READONLY_DB_PASSWORD = "role-pw-readonly" } : {}
        content {
          name        = env.key
          secret_name = env.value
        }
      }
      dynamic "env" {
        for_each = each.value.kind == "worker" ? { AZURE_STORAGE_ACCOUNT_URL = var.storage_blob_endpoint } : {}
        content {
          name  = env.key
          value = env.value
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].container[0].image]
  }
}

output "environment_id" { value = azurerm_container_app_environment.this.id }
output "environment_default_domain" { value = azurerm_container_app_environment.this.default_domain }
output "web_fqdn" { value = azurerm_container_app.web.ingress[0].fqdn }
output "admin_fqdn" { value = azurerm_container_app.admin.ingress[0].fqdn }
output "api_name" { value = azurerm_container_app.api.name }
output "web_name" { value = azurerm_container_app.web.name }
