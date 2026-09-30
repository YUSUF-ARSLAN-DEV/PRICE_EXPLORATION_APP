variable "zone_name" {
  type        = string
  description = "The registered .qa domain, e.g. example.qa (ADR-005)."
}
variable "resource_group_name" { type = string }
variable "tags" {
  type    = map(string)
  default = {}
}
variable "public_ip_address" { type = string }
variable "admin_label" {
  type    = string
  default = "admin"
}
variable "spf" {
  type        = string
  default     = "v=spf1 -all"
  description = "Replace with the email provider's include once chosen (e.g. v=spf1 include:<provider> -all)."
}
variable "dmarc" {
  type    = string
  default = "v=DMARC1; p=quarantine; rua=mailto:dmarc@example.qa; adkim=s; aspf=s"
}
variable "dkim_cnames" {
  type        = map(string)
  default     = {}
  description = "selector -> target, supplied by the email provider."
}

resource "azurerm_dns_zone" "this" {
  name                = var.zone_name
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_dns_a_record" "apex" {
  name                = "@"
  zone_name           = azurerm_dns_zone.this.name
  resource_group_name = var.resource_group_name
  ttl                 = 300
  records             = [var.public_ip_address]
}

resource "azurerm_dns_a_record" "admin" {
  name                = var.admin_label
  zone_name           = azurerm_dns_zone.this.name
  resource_group_name = var.resource_group_name
  ttl                 = 300
  records             = [var.public_ip_address]
}

resource "azurerm_dns_a_record" "www" {
  name                = "www"
  zone_name           = azurerm_dns_zone.this.name
  resource_group_name = var.resource_group_name
  ttl                 = 300
  records             = [var.public_ip_address]
}

resource "azurerm_dns_txt_record" "spf" {
  name                = "@"
  zone_name           = azurerm_dns_zone.this.name
  resource_group_name = var.resource_group_name
  ttl                 = 3600
  record {
    value = var.spf
  }
}

resource "azurerm_dns_txt_record" "dmarc" {
  name                = "_dmarc"
  zone_name           = azurerm_dns_zone.this.name
  resource_group_name = var.resource_group_name
  ttl                 = 3600
  record {
    value = var.dmarc
  }
}

resource "azurerm_dns_cname_record" "dkim" {
  for_each            = var.dkim_cnames
  name                = "${each.key}._domainkey"
  zone_name           = azurerm_dns_zone.this.name
  resource_group_name = var.resource_group_name
  ttl                 = 3600
  record              = each.value
}

# CAA: only the named CA may issue certificates for the domain.
resource "azurerm_dns_caa_record" "caa" {
  name                = "@"
  zone_name           = azurerm_dns_zone.this.name
  resource_group_name = var.resource_group_name
  ttl                 = 3600
  record {
    flags = 0
    tag   = "issue"
    value = "digicert.com"
  }
  record {
    flags = 0
    tag   = "iodef"
    value = "mailto:security@example.qa"
  }
}

output "name_servers" { value = azurerm_dns_zone.this.name_servers }
