variable "name" { type = string }
variable "location" { type = string }
variable "resource_group_name" { type = string }
variable "tags" {
  type    = map(string)
  default = {}
}

variable "gateway_subnet_id" { type = string }
variable "public_ip_id" { type = string }
variable "identity_gateway_id" { type = string }
variable "tls_certificate_secret_id" {
  type        = string
  description = "Versionless Key Vault secret id of the TLS certificate (PFX) for the public + admin hostnames."
}
variable "public_hostname" { type = string }
variable "admin_hostname" { type = string }
variable "web_fqdn" { type = string }
variable "admin_fqdn" { type = string }
variable "admin_allowed_cidrs" {
  type        = list(string)
  description = "Office / VPN ranges allowed to reach the admin host. Everything else gets a WAF block."
  validation {
    condition     = length(var.admin_allowed_cidrs) > 0
    error_message = "admin_allowed_cidrs must not be empty: the admin console must never be open to the internet."
  }
}
variable "zones" {
  type    = list(string)
  default = []
}
variable "waf_mode" {
  type    = string
  default = "Prevention"
  validation {
    condition     = contains(["Prevention", "Detection"], var.waf_mode)
    error_message = "waf_mode must be Prevention or Detection."
  }
}
variable "min_capacity" {
  type    = number
  default = 1
}
variable "max_capacity" {
  type    = number
  default = 4
}

locals {
  fe_ip = "fe-public"
}

resource "azurerm_web_application_firewall_policy" "this" {
  name                = "waf-${var.name}"
  resource_group_name = var.resource_group_name
  location            = var.location
  tags                = var.tags

  policy_settings {
    enabled                     = true
    mode                        = var.waf_mode
    request_body_check          = true
    max_request_body_size_in_kb = 128
    file_upload_limit_in_mb     = 10 # receipts are capped at 5 MB by the API
  }

  managed_rules {
    managed_rule_set {
      type    = "OWASP"
      version = "3.2"
    }
    managed_rule_set {
      type    = "Microsoft_BotManagerRuleSet"
      version = "1.1"
    }
  }

  # The admin console is reachable only from allow-listed networks (plan 8.2).
  custom_rules {
    name      = "AdminIpAllowList"
    priority  = 10
    rule_type = "MatchRule"
    action    = "Block"

    match_conditions {
      operator = "BeginsWith"
      match_variables {
        variable_name = "RequestHeaders"
        selector      = "Host"
      }
      match_values = ["${split(".", var.admin_hostname)[0]}."]
      transforms   = ["Lowercase"]
    }
    match_conditions {
      operator           = "IPMatch"
      negation_condition = true
      match_variables {
        variable_name = "RemoteAddr"
      }
      match_values = var.admin_allowed_cidrs
    }
  }
}

resource "azurerm_application_gateway" "this" {
  name                = "agw-${var.name}"
  resource_group_name = var.resource_group_name
  location            = var.location
  zones               = var.zones
  firewall_policy_id  = azurerm_web_application_firewall_policy.this.id
  http2_enabled       = true
  tags                = var.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [var.identity_gateway_id]
  }

  sku {
    name = "WAF_v2"
    tier = "WAF_v2"
  }
  autoscale_configuration {
    min_capacity = var.min_capacity
    max_capacity = var.max_capacity
  }

  # TLS 1.2+ only, modern ciphers (plan 8.2).
  ssl_policy {
    policy_type = "Predefined"
    policy_name = "AppGwSslPolicy20220101S"
  }

  gateway_ip_configuration {
    name      = "gateway-ip"
    subnet_id = var.gateway_subnet_id
  }
  frontend_ip_configuration {
    name                 = local.fe_ip
    public_ip_address_id = var.public_ip_id
  }
  frontend_port {
    name = "http"
    port = 80
  }
  frontend_port {
    name = "https"
    port = 443
  }

  ssl_certificate {
    name                = "site"
    key_vault_secret_id = var.tls_certificate_secret_id
  }

  backend_address_pool {
    name  = "web"
    fqdns = [var.web_fqdn]
  }
  backend_address_pool {
    name  = "admin"
    fqdns = [var.admin_fqdn]
  }

  probe {
    name                                      = "web"
    protocol                                  = "Https"
    path                                      = "/en"
    interval                                  = 30
    timeout                                   = 10
    unhealthy_threshold                       = 3
    pick_host_name_from_backend_http_settings = true
    match {
      status_code = ["200-399"]
    }
  }
  probe {
    name                                      = "admin"
    protocol                                  = "Https"
    path                                      = "/"
    interval                                  = 30
    timeout                                   = 10
    unhealthy_threshold                       = 3
    pick_host_name_from_backend_http_settings = true
    match {
      status_code = ["200-399"]
    }
  }

  backend_http_settings {
    name                                = "web"
    cookie_based_affinity               = "Disabled"
    port                                = 443
    protocol                            = "Https"
    request_timeout                     = 30
    pick_host_name_from_backend_address = true
    probe_name                          = "web"
  }
  backend_http_settings {
    name                                = "admin"
    cookie_based_affinity               = "Disabled"
    port                                = 443
    protocol                            = "Https"
    request_timeout                     = 30
    pick_host_name_from_backend_address = true
    probe_name                          = "admin"
  }

  http_listener {
    name                           = "http"
    frontend_ip_configuration_name = local.fe_ip
    frontend_port_name             = "http"
    protocol                       = "Http"
    host_names                     = [var.public_hostname, var.admin_hostname]
  }
  http_listener {
    name                           = "web-https"
    frontend_ip_configuration_name = local.fe_ip
    frontend_port_name             = "https"
    protocol                       = "Https"
    ssl_certificate_name           = "site"
    host_name                      = var.public_hostname
  }
  http_listener {
    name                           = "admin-https"
    frontend_ip_configuration_name = local.fe_ip
    frontend_port_name             = "https"
    protocol                       = "Https"
    ssl_certificate_name           = "site"
    host_name                      = var.admin_hostname
  }

  redirect_configuration {
    name                 = "to-https"
    redirect_type        = "Permanent"
    target_listener_name = "web-https"
    include_path         = true
    include_query_string = true
  }

  request_routing_rule {
    name                        = "http-to-https"
    rule_type                   = "Basic"
    priority                    = 10
    http_listener_name          = "http"
    redirect_configuration_name = "to-https"
  }
  request_routing_rule {
    name                       = "web"
    rule_type                  = "Basic"
    priority                   = 20
    http_listener_name         = "web-https"
    backend_address_pool_name  = "web"
    backend_http_settings_name = "web"
  }
  request_routing_rule {
    name                       = "admin"
    rule_type                  = "Basic"
    priority                   = 30
    http_listener_name         = "admin-https"
    backend_address_pool_name  = "admin"
    backend_http_settings_name = "admin"
  }

  lifecycle {
    ignore_changes = [ssl_certificate]
  }
}

output "gateway_id" { value = azurerm_application_gateway.this.id }
