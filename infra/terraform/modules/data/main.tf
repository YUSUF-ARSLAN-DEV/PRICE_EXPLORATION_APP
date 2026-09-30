variable "name" { type = string }
variable "location" { type = string }
variable "resource_group_name" { type = string }
variable "tags" {
  type    = map(string)
  default = {}
}

variable "postgres_subnet_id" { type = string }
variable "postgres_dns_zone_id" { type = string }
variable "endpoints_subnet_id" { type = string }
variable "blob_dns_zone_id" { type = string }
variable "tenant_id" { type = string }

variable "postgres_sku" {
  type        = string
  default     = "B_Standard_B1ms"
  description = "B_Standard_B1ms (dev), GP_Standard_D2ds_v5 (staging/prod). Confirm availability in Qatar Central (plan step 9.0)."
}
variable "postgres_storage_mb" {
  type    = number
  default = 32768
}
variable "postgres_ha_mode" {
  type        = string
  default     = "Disabled"
  description = "Disabled | SameZone | ZoneRedundant (ZoneRedundant only if the region supports availability zones)."
  validation {
    condition     = contains(["Disabled", "SameZone", "ZoneRedundant"], var.postgres_ha_mode)
    error_message = "postgres_ha_mode must be Disabled, SameZone or ZoneRedundant."
  }
}
variable "postgres_backup_retention_days" {
  type    = number
  default = 7
}
variable "postgres_admin_login" {
  type    = string
  default = "qaribadmin"
}
variable "postgres_admin_password" {
  type      = string
  sensitive = true
}
variable "receipt_retention_days" {
  type        = number
  default     = 8
  description = "Safety-net lifecycle delete for receipt images. The app deletes at 7 days; this catches failures."
}
variable "artefact_retention_days" {
  type        = number
  default     = 95
  description = "Safety-net lifecycle delete for raw ingestion artefacts (policy: 90 days)."
}

resource "random_string" "sa" {
  length  = 6
  upper   = false
  special = false
}

# ---------------------------------------------------------------------------- PostgreSQL
resource "azurerm_postgresql_flexible_server" "this" {
  name                          = "psql-${var.name}"
  resource_group_name           = var.resource_group_name
  location                      = var.location
  version                       = "16"
  delegated_subnet_id           = var.postgres_subnet_id
  private_dns_zone_id           = var.postgres_dns_zone_id
  public_network_access_enabled = false
  administrator_login           = var.postgres_admin_login
  administrator_password        = var.postgres_admin_password
  sku_name                      = var.postgres_sku
  storage_mb                    = var.postgres_storage_mb
  backup_retention_days         = var.postgres_backup_retention_days
  geo_redundant_backup_enabled  = false # data stays in Qatar (PDPPL); no cross-border backup copy
  tags                          = var.tags

  authentication {
    active_directory_auth_enabled = true
    password_auth_enabled         = true
    tenant_id                     = var.tenant_id
  }

  dynamic "high_availability" {
    for_each = var.postgres_ha_mode == "Disabled" ? [] : [1]
    content {
      mode = var.postgres_ha_mode
    }
  }

  maintenance_window {
    day_of_week  = 0 # Sunday
    start_hour   = 1
    start_minute = 0
  }

  lifecycle {
    ignore_changes = [zone, high_availability[0].standby_availability_zone]
  }
}

resource "azurerm_postgresql_flexible_server_database" "qarib" {
  name      = "qarib"
  server_id = azurerm_postgresql_flexible_server.this.id
  collation = "en_US.utf8"
  charset   = "UTF8"
}

# Extensions required by the migrations (plan 9.0): allow-list them on the server.
resource "azurerm_postgresql_flexible_server_configuration" "extensions" {
  name      = "azure.extensions"
  server_id = azurerm_postgresql_flexible_server.this.id
  value     = "PG_TRGM,CITEXT,VECTOR,UNACCENT"
}

resource "azurerm_postgresql_flexible_server_configuration" "log_slow" {
  name      = "log_min_duration_statement"
  server_id = azurerm_postgresql_flexible_server.this.id
  value     = "500"
}

resource "azurerm_postgresql_flexible_server_configuration" "connection_throttle" {
  name      = "connection_throttle.enable"
  server_id = azurerm_postgresql_flexible_server.this.id
  value     = "on"
}

# ---------------------------------------------------------------------------- Blob storage
resource "azurerm_storage_account" "this" {
  name                            = "stqarib${replace(var.name, "-", "")}${random_string.sa.result}"
  resource_group_name             = var.resource_group_name
  location                        = var.location
  account_tier                    = "Standard"
  account_replication_type        = "ZRS"
  min_tls_version                 = "TLS1_2"
  https_traffic_only_enabled      = true
  allow_nested_items_to_be_public = false
  shared_access_key_enabled       = false # managed identity only
  public_network_access_enabled   = false
  tags                            = var.tags

  network_rules {
    default_action = "Deny"
    bypass         = ["AzureServices"]
  }

  blob_properties {
    delete_retention_policy {
      days = 7
    }
  }
}

resource "azurerm_storage_container" "receipts" {
  name                  = "receipts"
  storage_account_id    = azurerm_storage_account.this.id
  container_access_type = "private"
}

resource "azurerm_storage_container" "artefacts" {
  name                  = "raw-artefacts"
  storage_account_id    = azurerm_storage_account.this.id
  container_access_type = "private"
}

resource "azurerm_storage_management_policy" "retention" {
  storage_account_id = azurerm_storage_account.this.id

  rule {
    name    = "receipts-safety-net"
    enabled = true
    filters {
      blob_types   = ["blockBlob"]
      prefix_match = ["receipts/"]
    }
    actions {
      base_blob {
        delete_after_days_since_modification_greater_than = var.receipt_retention_days
      }
      snapshot {
        delete_after_days_since_creation_greater_than = var.receipt_retention_days
      }
    }
  }

  rule {
    name    = "artefacts-safety-net"
    enabled = true
    filters {
      blob_types   = ["blockBlob"]
      prefix_match = ["raw-artefacts/"]
    }
    actions {
      base_blob {
        delete_after_days_since_modification_greater_than = var.artefact_retention_days
      }
    }
  }
}

resource "azurerm_private_endpoint" "blob" {
  name                = "pe-${var.name}-blob"
  location            = var.location
  resource_group_name = var.resource_group_name
  subnet_id           = var.endpoints_subnet_id
  tags                = var.tags

  private_service_connection {
    name                           = "blob"
    private_connection_resource_id = azurerm_storage_account.this.id
    subresource_names              = ["blob"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "blob"
    private_dns_zone_ids = [var.blob_dns_zone_id]
  }
}

output "postgres_fqdn" { value = azurerm_postgresql_flexible_server.this.fqdn }
output "postgres_server_id" { value = azurerm_postgresql_flexible_server.this.id }
output "postgres_admin_login" { value = var.postgres_admin_login }
output "database_name" { value = azurerm_postgresql_flexible_server_database.qarib.name }
output "storage_account_id" { value = azurerm_storage_account.this.id }
output "blob_endpoint" { value = azurerm_storage_account.this.primary_blob_endpoint }
