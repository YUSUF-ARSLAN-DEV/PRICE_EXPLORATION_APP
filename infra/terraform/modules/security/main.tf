variable "name" { type = string }
variable "location" { type = string }
variable "resource_group_name" { type = string }
variable "tenant_id" { type = string }
variable "tags" {
  type    = map(string)
  default = {}
}
variable "endpoints_subnet_id" { type = string }
variable "vault_dns_zone_id" { type = string }
variable "storage_account_id" { type = string }
variable "acr_sku" {
  type    = string
  default = "Standard"
}
variable "key_vault_allowed_ips" {
  type        = list(string)
  default     = []
  description = "Public IPs allowed to manage secrets (CI runners / admins). Apps use the private endpoint."
}
variable "deployer_object_id" {
  type        = string
  description = "Object id of the identity that runs Terraform (gets Key Vault Secrets Officer)."
}

resource "random_string" "kv" {
  length  = 4
  upper   = false
  special = false
}

# ---------------------------------------------------------------------------- Key Vault
resource "azurerm_key_vault" "this" {
  name                          = "kv-${var.name}-${random_string.kv.result}"
  location                      = var.location
  resource_group_name           = var.resource_group_name
  tenant_id                     = var.tenant_id
  sku_name                      = "standard"
  rbac_authorization_enabled    = true
  purge_protection_enabled      = true
  soft_delete_retention_days    = 90
  public_network_access_enabled = true
  tags                          = var.tags

  network_acls {
    default_action = "Deny"
    bypass         = "AzureServices"
    ip_rules       = var.key_vault_allowed_ips
  }
}

resource "azurerm_private_endpoint" "vault" {
  name                = "pe-${var.name}-kv"
  location            = var.location
  resource_group_name = var.resource_group_name
  subnet_id           = var.endpoints_subnet_id
  tags                = var.tags

  private_service_connection {
    name                           = "vault"
    private_connection_resource_id = azurerm_key_vault.this.id
    subresource_names              = ["vault"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "vault"
    private_dns_zone_ids = [var.vault_dns_zone_id]
  }
}

resource "azurerm_role_assignment" "deployer_secrets" {
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = var.deployer_object_id
}

# ---------------------------------------------------------------------------- Registry
resource "random_string" "acr" {
  length  = 5
  upper   = false
  special = false
}

resource "azurerm_container_registry" "this" {
  name                          = "acrqarib${replace(var.name, "-", "")}${random_string.acr.result}"
  resource_group_name           = var.resource_group_name
  location                      = var.location
  sku                           = var.acr_sku
  admin_enabled                 = false
  anonymous_pull_enabled        = false
  public_network_access_enabled = true
  tags                          = var.tags
}

# ---------------------------------------------------------------------------- Identities
# One identity per workload so a compromise of one cannot read another's secrets.
resource "azurerm_user_assigned_identity" "api" {
  name                = "id-${var.name}-api"
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_user_assigned_identity" "web" {
  name                = "id-${var.name}-web"
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_user_assigned_identity" "worker" {
  name                = "id-${var.name}-worker"
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_user_assigned_identity" "gateway" {
  name                = "id-${var.name}-gateway"
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

locals {
  app_identities = {
    api    = azurerm_user_assigned_identity.api.principal_id
    web    = azurerm_user_assigned_identity.web.principal_id
    worker = azurerm_user_assigned_identity.worker.principal_id
  }
  blob_identities = {
    api    = azurerm_user_assigned_identity.api.principal_id
    worker = azurerm_user_assigned_identity.worker.principal_id
  }
}

resource "azurerm_role_assignment" "kv_secrets_user" {
  for_each             = local.app_identities
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = each.value
}

resource "azurerm_role_assignment" "acr_pull" {
  for_each             = local.app_identities
  scope                = azurerm_container_registry.this.id
  role_definition_name = "AcrPull"
  principal_id         = each.value
}

resource "azurerm_role_assignment" "blob_contributor" {
  for_each             = local.blob_identities
  scope                = var.storage_account_id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = each.value
}

resource "azurerm_role_assignment" "gateway_kv_certs" {
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.gateway.principal_id
}

# ---------------------------------------------------------------------------- Generated secrets
# Values live in Terraform state: keep the state account private (Entra-only) and encrypted.
resource "random_password" "jwt" {
  length  = 64
  special = false
}

resource "random_password" "meili" {
  length  = 48
  special = false
}

resource "random_password" "db_api" {
  length  = 40
  special = false
}

resource "random_password" "db_worker" {
  length  = 40
  special = false
}

resource "random_password" "db_readonly" {
  length  = 40
  special = false
}

resource "random_password" "db_admin" {
  length  = 40
  special = false
}

resource "azurerm_key_vault_secret" "jwt" {
  name         = "jwt-secret"
  value        = random_password.jwt.result
  key_vault_id = azurerm_key_vault.this.id
  depends_on   = [azurerm_role_assignment.deployer_secrets]
}

resource "azurerm_key_vault_secret" "meili" {
  name         = "meili-master-key"
  value        = random_password.meili.result
  key_vault_id = azurerm_key_vault.this.id
  depends_on   = [azurerm_role_assignment.deployer_secrets]
}

output "key_vault_id" { value = azurerm_key_vault.this.id }
output "key_vault_uri" { value = azurerm_key_vault.this.vault_uri }
output "key_vault_name" { value = azurerm_key_vault.this.name }
output "acr_id" { value = azurerm_container_registry.this.id }
output "acr_login_server" { value = azurerm_container_registry.this.login_server }
output "identity_api_id" { value = azurerm_user_assigned_identity.api.id }
output "identity_web_id" { value = azurerm_user_assigned_identity.web.id }
output "identity_worker_id" { value = azurerm_user_assigned_identity.worker.id }
output "identity_gateway_id" { value = azurerm_user_assigned_identity.gateway.id }
output "jwt_secret_versionless_id" { value = azurerm_key_vault_secret.jwt.versionless_id }
output "meili_secret_versionless_id" { value = azurerm_key_vault_secret.meili.versionless_id }
output "passwords" {
  sensitive = true
  value = {
    api      = random_password.db_api.result
    worker   = random_password.db_worker.result
    readonly = random_password.db_readonly.result
    admin    = random_password.db_admin.result
    meili    = random_password.meili.result
  }
}
