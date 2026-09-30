# Plan step 9.0 - Azure Qatar Central availability spike.
# Throwaway sandbox: deploys the smallest SKU of each service the architecture (plan 9.2) needs,
# so we learn what actually exists in Qatar Central. Every `apply` failure is a finding to log in
# docs/architecture/azure-availability.md. Run `terraform destroy` afterwards (costs money).
#
# NOT YET VALIDATED: written without an Azure subscription or terraform binary available.
# Expect to adjust SKUs/arguments to the current azurerm provider version.
#
# Use:  az login
#       terraform init
#       terraform apply -var="subscription_id=<id>" -var="pg_admin_password=<strong>"
#       (apply each resource individually with -target=... to see which ones fail)

terraform {
  required_version = ">= 1.6"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 5.7"
    }
  }
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
}

variable "subscription_id" { type = string }
variable "location" {
  type    = string
  default = "qatarcentral"
}
variable "prefix" {
  type    = string
  default = "qaribspike"
}
variable "pg_admin_password" {
  type      = string
  sensitive = true
}

data "azurerm_client_config" "current" {}

resource "azurerm_resource_group" "spike" {
  name     = "${var.prefix}-rg"
  location = var.location
  tags     = { purpose = "availability-spike", delete-after = "spike" }
}

resource "azurerm_log_analytics_workspace" "spike" {
  name                = "${var.prefix}-law"
  location            = azurerm_resource_group.spike.location
  resource_group_name = azurerm_resource_group.spike.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
}

resource "azurerm_container_app_environment" "spike" {
  name                       = "${var.prefix}-cae"
  location                   = azurerm_resource_group.spike.location
  resource_group_name        = azurerm_resource_group.spike.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.spike.id
}

resource "azurerm_postgresql_flexible_server" "spike" {
  name                          = "${var.prefix}-pg"
  location                      = azurerm_resource_group.spike.location
  resource_group_name           = azurerm_resource_group.spike.name
  version                       = "16"
  administrator_login           = "qaribadmin"
  administrator_password        = var.pg_admin_password
  sku_name                      = "B_Standard_B1ms"
  storage_mb                    = 32768
  public_network_access_enabled = false # spike only tests existence; no data stored
  lifecycle { ignore_changes = [zone] }
}

# Extensions required by plan Phases 2/4 - check allow-listing works in-region.
resource "azurerm_postgresql_flexible_server_configuration" "extensions" {
  name      = "azure.extensions"
  server_id = azurerm_postgresql_flexible_server.spike.id
  value     = "PG_TRGM,CITEXT,VECTOR,UNACCENT,PG_PARTMAN"
}

resource "azurerm_redis_cache" "spike" {
  name                = "${var.prefix}-redis"
  location            = azurerm_resource_group.spike.location
  resource_group_name = azurerm_resource_group.spike.name
  capacity            = 0
  family              = "C"
  sku_name            = "Basic"
  minimum_tls_version = "1.2"
}

resource "azurerm_storage_account" "spike" {
  name                            = "${var.prefix}sa"
  location                        = azurerm_resource_group.spike.location
  resource_group_name             = azurerm_resource_group.spike.name
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false
  network_rules {
    default_action = "Deny"
    bypass         = ["AzureServices"]
  }
}

resource "azurerm_key_vault" "spike" {
  name                       = "${var.prefix}-kv"
  location                   = azurerm_resource_group.spike.location
  resource_group_name        = azurerm_resource_group.spike.name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  purge_protection_enabled   = true
  soft_delete_retention_days = 7
  network_acls {
    default_action = "Deny"
    bypass         = "AzureServices"
  }
}

resource "azurerm_container_registry" "spike" {
  name                = "${var.prefix}acr"
  location            = azurerm_resource_group.spike.location
  resource_group_name = azurerm_resource_group.spike.name
  sku                 = "Basic"
}

resource "azurerm_servicebus_namespace" "spike" {
  name                = "${var.prefix}-sb"
  location            = azurerm_resource_group.spike.location
  resource_group_name = azurerm_resource_group.spike.name
  sku                 = "Basic"
}

# Application Gateway WAF_v2 and DNS zone are deliberately left to manual/portal checks
# (Application Gateway is slow/expensive to spin up): verify in the portal that
# "Application Gateway v2 + WAF" can be created in Qatar Central, and record the result.
resource "azurerm_dns_zone" "spike" {
  name                = "spike-example.test"
  resource_group_name = azurerm_resource_group.spike.name
}
