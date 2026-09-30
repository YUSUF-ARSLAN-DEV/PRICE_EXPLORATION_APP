# One-time bootstrap: the storage account that holds Terraform state for every environment.
# Run by an administrator with `az login`, local state, then never again:
#   terraform init && terraform apply -var subscription_id=<id>
# Afterwards each env's backend.tf points at this account (state is locked by blob lease).
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
variable "allowed_ips" {
  type        = list(string)
  default     = []
  description = "Public IPs (admins / CI runners) allowed to reach the state account."
}
variable "name_prefix" {
  type        = string
  default     = "qaribtf"
  description = "3-8 lowercase letters/digits; the storage account name is prefix + random suffix."
}

resource "random_string" "suffix" {
  length  = 6
  upper   = false
  special = false
}

resource "azurerm_resource_group" "state" {
  name     = "rg-qarib-tfstate"
  location = var.location
  tags     = { purpose = "terraform-state" }
}

resource "azurerm_storage_account" "state" {
  name                            = "${var.name_prefix}${random_string.suffix.result}"
  resource_group_name             = azurerm_resource_group.state.name
  location                        = azurerm_resource_group.state.location
  account_tier                    = "Standard"
  account_replication_type        = "ZRS"
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false
  shared_access_key_enabled       = false # access via Entra ID only
  network_rules {
    default_action = "Deny"
    bypass         = ["AzureServices"]
    ip_rules       = var.allowed_ips
  }
  blob_properties {
    versioning_enabled = true
    delete_retention_policy {
      days = 30
    }
  }
  tags = { purpose = "terraform-state" }
}

resource "azurerm_storage_container" "state" {
  name                  = "tfstate"
  storage_account_id    = azurerm_storage_account.state.id
  container_access_type = "private"
}

output "storage_account_name" { value = azurerm_storage_account.state.name }
output "container_name" { value = azurerm_storage_container.state.name }
output "resource_group_name" { value = azurerm_resource_group.state.name }
