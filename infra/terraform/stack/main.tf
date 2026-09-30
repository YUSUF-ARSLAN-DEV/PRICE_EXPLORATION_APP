# One environment = one run of this root module with that environment's backend + tfvars:
#   terraform -chdir=infra/terraform/stack init -backend-config=../envs/dev/backend.hcl
#   terraform -chdir=infra/terraform/stack plan  -var-file=../envs/dev/terraform.tfvars
# Plan step 9.3: everything in code, remote locked state, no console click-ops in staging/prod.
terraform {
  required_version = ">= 1.6"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
  backend "azurerm" {} # configured by envs/<env>/backend.hcl
}

provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy = false
    }
    resource_group {
      prevent_deletion_if_contains_resources = true
    }
  }
  subscription_id     = var.subscription_id
  storage_use_azuread = true
}

data "azurerm_client_config" "current" {}

locals {
  name = "qarib-${var.environment}"
  tags = {
    app         = "qarib"
    environment = var.environment
    managed_by  = "terraform"
    data_class  = "personal-data" # PDPPL: this environment may hold personal data
  }
}

resource "azurerm_resource_group" "this" {
  name     = "rg-${local.name}"
  location = var.location
  tags     = local.tags
}

resource "azurerm_public_ip" "gateway" {
  name                = "pip-${local.name}-gateway"
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  allocation_method   = "Static"
  sku                 = "Standard"
  zones               = var.availability_zones
  tags                = local.tags
}

module "network" {
  source              = "../modules/network"
  name                = local.name
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  address_space       = var.address_space
  tags                = local.tags
}

module "security" {
  source                = "../modules/security"
  name                  = local.name
  location              = var.location
  resource_group_name   = azurerm_resource_group.this.name
  tenant_id             = data.azurerm_client_config.current.tenant_id
  tags                  = local.tags
  endpoints_subnet_id   = module.network.endpoints_subnet_id
  vault_dns_zone_id     = module.network.vault_dns_zone_id
  storage_account_id    = module.data.storage_account_id
  key_vault_allowed_ips = var.key_vault_allowed_ips
  deployer_object_id    = data.azurerm_client_config.current.object_id
}

module "data" {
  source                         = "../modules/data"
  name                           = local.name
  location                       = var.location
  resource_group_name            = azurerm_resource_group.this.name
  tags                           = local.tags
  tenant_id                      = data.azurerm_client_config.current.tenant_id
  postgres_subnet_id             = module.network.postgres_subnet_id
  postgres_dns_zone_id           = module.network.postgres_dns_zone_id
  endpoints_subnet_id            = module.network.endpoints_subnet_id
  blob_dns_zone_id               = module.network.blob_dns_zone_id
  postgres_sku                   = var.postgres_sku
  postgres_storage_mb            = var.postgres_storage_mb
  postgres_ha_mode               = var.postgres_ha_mode
  postgres_backup_retention_days = var.postgres_backup_retention_days
  postgres_admin_password        = module.security.passwords.admin
}

# Connection strings (contain passwords) live only in Key Vault; workloads read them via identity.
locals {
  pg = "${module.data.postgres_fqdn}:5432/${module.data.database_name}?sslmode=require"
}

resource "azurerm_key_vault_secret" "db_migrator" {
  name         = "database-url-migrator"
  value        = "postgresql://${module.data.postgres_admin_login}:${module.security.passwords.admin}@${local.pg}"
  key_vault_id = module.security.key_vault_id
  depends_on   = [module.security]
}

resource "azurerm_key_vault_secret" "db_api" {
  name         = "database-url-api"
  value        = "postgresql://qarib_api:${module.security.passwords.api}@${local.pg}"
  key_vault_id = module.security.key_vault_id
  depends_on   = [module.security]
}

resource "azurerm_key_vault_secret" "db_worker" {
  name         = "database-url-worker"
  value        = "postgresql://qarib_worker:${module.security.passwords.worker}@${local.pg}"
  key_vault_id = module.security.key_vault_id
  depends_on   = [module.security]
}

resource "azurerm_key_vault_secret" "pw_api" {
  name         = "db-password-api"
  value        = module.security.passwords.api
  key_vault_id = module.security.key_vault_id
  depends_on   = [module.security]
}

resource "azurerm_key_vault_secret" "pw_worker" {
  name         = "db-password-worker"
  value        = module.security.passwords.worker
  key_vault_id = module.security.key_vault_id
  depends_on   = [module.security]
}

resource "azurerm_key_vault_secret" "pw_readonly" {
  name         = "db-password-readonly"
  value        = module.security.passwords.readonly
  key_vault_id = module.security.key_vault_id
  depends_on   = [module.security]
}

module "observability" {
  source              = "../modules/observability"
  name                = local.name
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  resource_group_id   = azurerm_resource_group.this.id
  tags                = local.tags
  alert_emails        = var.alert_emails
  alert_webhook_url   = var.alert_webhook_url
  log_retention_days  = var.log_retention_days
  postgres_server_id  = module.data.postgres_server_id
  public_url          = var.enable_edge ? "https://${var.public_hostname}/en" : ""
  monthly_budget      = var.monthly_budget
}

module "apps" {
  source                     = "../modules/apps"
  name                       = local.name
  location                   = var.location
  resource_group_name        = azurerm_resource_group.this.name
  tags                       = local.tags
  apps_subnet_id             = module.network.apps_subnet_id
  log_analytics_workspace_id = module.observability.log_analytics_workspace_id
  zone_redundant             = var.zone_redundant
  acr_login_server           = module.security.acr_login_server
  key_vault_uri              = module.security.key_vault_uri
  identity_api_id            = module.security.identity_api_id
  identity_web_id            = module.security.identity_web_id
  identity_worker_id         = module.security.identity_worker_id
  storage_blob_endpoint      = module.data.blob_endpoint
  public_hostname            = var.public_hostname
  admin_hostname             = var.admin_hostname
  gateway_public_ip          = azurerm_public_ip.gateway.ip_address
  site_indexing              = var.site_indexing
  web_min_replicas           = var.web_min_replicas
  web_max_replicas           = var.web_max_replicas
  api_min_replicas           = var.api_min_replicas
  api_max_replicas           = var.api_max_replicas
  legal_email                = var.legal_email
  mail_from                  = var.mail_from
  smtp_host                  = var.smtp_host
  ingest_user_agent          = var.ingest_user_agent

  secret_ids = {
    jwt               = module.security.jwt_secret_versionless_id
    meili             = module.security.meili_secret_versionless_id
    database_api      = azurerm_key_vault_secret.db_api.versionless_id
    database_worker   = azurerm_key_vault_secret.db_worker.versionless_id
    database_migrator = azurerm_key_vault_secret.db_migrator.versionless_id
  }
  role_password_secret_ids = {
    api      = azurerm_key_vault_secret.pw_api.versionless_id
    worker   = azurerm_key_vault_secret.pw_worker.versionless_id
    readonly = azurerm_key_vault_secret.pw_readonly.versionless_id
  }
}

# The edge (WAF + TLS) is created once a certificate exists in Key Vault: apply with
# enable_edge=false first, import the certificate, then set enable_edge=true (runbooks/deploy.md).
module "edge" {
  count                     = var.enable_edge ? 1 : 0
  source                    = "../modules/edge"
  name                      = local.name
  location                  = var.location
  resource_group_name       = azurerm_resource_group.this.name
  tags                      = local.tags
  gateway_subnet_id         = module.network.gateway_subnet_id
  public_ip_id              = azurerm_public_ip.gateway.id
  identity_gateway_id       = module.security.identity_gateway_id
  tls_certificate_secret_id = var.tls_certificate_secret_id
  public_hostname           = var.public_hostname
  admin_hostname            = var.admin_hostname
  web_fqdn                  = module.apps.web_fqdn
  admin_fqdn                = module.apps.admin_fqdn
  admin_allowed_cidrs       = var.admin_allowed_cidrs
  zones                     = var.availability_zones
  waf_mode                  = var.waf_mode
}

module "dns" {
  count               = var.manage_dns ? 1 : 0
  source              = "../modules/dns"
  zone_name           = var.dns_zone_name
  resource_group_name = azurerm_resource_group.this.name
  tags                = local.tags
  public_ip_address   = azurerm_public_ip.gateway.ip_address
  admin_label         = split(".", var.admin_hostname)[0]
}
