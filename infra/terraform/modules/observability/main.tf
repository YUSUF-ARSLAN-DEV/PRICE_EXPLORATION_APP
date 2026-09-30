variable "name" { type = string }
variable "location" { type = string }
variable "resource_group_name" { type = string }
variable "tags" {
  type    = map(string)
  default = {}
}
variable "alert_emails" {
  type        = list(string)
  description = "On-call addresses. Add a webhook receiver (Teams/WhatsApp bridge/PagerDuty) via alert_webhook_url."
}
variable "alert_webhook_url" {
  type      = string
  default   = ""
  sensitive = true
}
variable "log_retention_days" {
  type        = number
  default     = 30
  description = "Plan 0.9: server logs with (truncated) IPs are kept 30 days."
}
variable "postgres_server_id" { type = string }
variable "public_url" {
  type        = string
  default     = ""
  description = "https://<domain>/en - when set, an availability web test is created."
}
variable "monthly_budget" {
  type        = number
  default     = 900
  description = "Budget in the billing currency; alerts at 50/80/100 %. Plan 9.7 target 400-900."
}
variable "resource_group_id" { type = string }

resource "azurerm_log_analytics_workspace" "this" {
  name                = "log-${var.name}"
  location            = var.location
  resource_group_name = var.resource_group_name
  sku                 = "PerGB2018"
  retention_in_days   = var.log_retention_days
  tags                = var.tags
}

resource "azurerm_application_insights" "this" {
  name                = "appi-${var.name}"
  location            = var.location
  resource_group_name = var.resource_group_name
  workspace_id        = azurerm_log_analytics_workspace.this.id
  application_type    = "web"
  # IPs are masked by default; we additionally never send request bodies, cookies or query strings.
  ip_masking_enabled = true
  tags               = var.tags
}

resource "azurerm_monitor_action_group" "oncall" {
  name                = "ag-${var.name}-oncall"
  resource_group_name = var.resource_group_name
  short_name          = "qaribops"
  tags                = var.tags

  dynamic "email_receiver" {
    for_each = toset(var.alert_emails)
    content {
      name                    = "email-${substr(md5(email_receiver.value), 0, 6)}"
      email_address           = email_receiver.value
      use_common_alert_schema = true
    }
  }

  dynamic "webhook_receiver" {
    for_each = nonsensitive(var.alert_webhook_url != "") ? [1] : []
    content {
      name                    = "webhook"
      service_uri             = var.alert_webhook_url
      use_common_alert_schema = true
    }
  }
}

# ---------------------------------------------------------------------------- log alerts
locals {
  log_alerts = {
    api-5xx = {
      description = "API returned >= 5 server errors in 5 minutes (SLO: availability 99.5%)"
      severity    = 1
      query       = <<-KQL
        ContainerAppConsoleLogs_CL
        | where ContainerAppName_s == 'api' and Log_s has '"status":5'
        | where Log_s has '"method"'
      KQL
      threshold   = 5
    }
    freshness-breach = {
      description = "A source has not delivered fresh prices within its freshness target (qarib.freshness.breach)"
      severity    = 2
      query       = <<-KQL
        ContainerAppConsoleLogs_CL
        | where Log_s has 'qarib.freshness.breach'
      KQL
      threshold   = 0
    }
    source-auto-disabled = {
      description = "The circuit breaker disabled a source after repeated 403/429/CAPTCHA responses - a human must review it"
      severity    = 1
      query       = <<-KQL
        ContainerAppConsoleLogs_CL
        | where Log_s has 'source' and Log_s has 'disabled automatically'
      KQL
      threshold   = 0
    }
    job-failures = {
      description = "An ingestion / maintenance job failed"
      severity    = 2
      query       = <<-KQL
        ContainerAppSystemLogs_CL
        | where Reason_s in ('ContainerTerminated', 'BackoffLimitExceeded') and Log_s has 'job'
      KQL
      threshold   = 0
    }
  }
}

resource "azurerm_monitor_scheduled_query_rules_alert_v2" "log" {
  for_each             = local.log_alerts
  name                 = "alert-${var.name}-${each.key}"
  resource_group_name  = var.resource_group_name
  location             = var.location
  description          = each.value.description
  severity             = each.value.severity
  enabled              = true
  evaluation_frequency = "PT5M"
  window_duration      = "PT5M"
  scopes               = [azurerm_log_analytics_workspace.this.id]
  tags                 = var.tags

  criteria {
    query                   = each.value.query
    time_aggregation_method = "Count"
    operator                = "GreaterThan"
    threshold               = each.value.threshold
    failing_periods {
      minimum_failing_periods_to_trigger_alert = 1
      number_of_evaluation_periods             = 1
    }
  }

  action {
    action_groups = [azurerm_monitor_action_group.oncall.id]
  }
}

# ---------------------------------------------------------------------------- database alerts
resource "azurerm_monitor_metric_alert" "pg_cpu" {
  name                = "alert-${var.name}-pg-cpu"
  resource_group_name = var.resource_group_name
  scopes              = [var.postgres_server_id]
  description         = "Postgres CPU > 85% for 15 minutes"
  severity            = 2
  frequency           = "PT5M"
  window_size         = "PT15M"
  tags                = var.tags

  criteria {
    metric_namespace = "Microsoft.DBforPostgreSQL/flexibleServers"
    metric_name      = "cpu_percent"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 85
  }
  action {
    action_group_id = azurerm_monitor_action_group.oncall.id
  }
}

resource "azurerm_monitor_metric_alert" "pg_storage" {
  name                = "alert-${var.name}-pg-storage"
  resource_group_name = var.resource_group_name
  scopes              = [var.postgres_server_id]
  description         = "Postgres storage > 85%"
  severity            = 1
  frequency           = "PT15M"
  window_size         = "PT30M"
  tags                = var.tags

  criteria {
    metric_namespace = "Microsoft.DBforPostgreSQL/flexibleServers"
    metric_name      = "storage_percent"
    aggregation      = "Maximum"
    operator         = "GreaterThan"
    threshold        = 85
  }
  action {
    action_group_id = azurerm_monitor_action_group.oncall.id
  }
}

# ---------------------------------------------------------------------------- availability
resource "azurerm_application_insights_standard_web_test" "home" {
  count                   = var.public_url == "" ? 0 : 1
  name                    = "webtest-${var.name}-home"
  resource_group_name     = var.resource_group_name
  location                = var.location
  application_insights_id = azurerm_application_insights.this.id
  geo_locations           = ["emea-ru-msa-edge", "emea-gb-db3-azr", "emea-nl-ams-azr"]
  frequency               = 300
  timeout                 = 30
  enabled                 = true
  tags                    = merge(var.tags, { "hidden-link:${azurerm_application_insights.this.id}" = "Resource" })

  request {
    url = var.public_url
  }
  validation_rules {
    expected_status_code = 200
    ssl_check_enabled    = true
  }
}

resource "azurerm_monitor_metric_alert" "availability" {
  count               = var.public_url == "" ? 0 : 1
  name                = "alert-${var.name}-availability"
  resource_group_name = var.resource_group_name
  scopes              = [azurerm_application_insights_standard_web_test.home[0].id, azurerm_application_insights.this.id]
  description         = "Public site failed the availability test from >= 2 locations"
  severity            = 0
  frequency           = "PT1M"
  window_size         = "PT5M"
  tags                = var.tags

  application_insights_web_test_location_availability_criteria {
    web_test_id           = azurerm_application_insights_standard_web_test.home[0].id
    component_id          = azurerm_application_insights.this.id
    failed_location_count = 2
  }
  action {
    action_group_id = azurerm_monitor_action_group.oncall.id
  }
}

# ---------------------------------------------------------------------------- cost guardrail
resource "azurerm_consumption_budget_resource_group" "monthly" {
  name              = "budget-${var.name}"
  resource_group_id = var.resource_group_id
  amount            = var.monthly_budget
  time_grain        = "Monthly"

  time_period {
    start_date = formatdate("YYYY-MM-01'T'00:00:00Z", timestamp())
  }

  dynamic "notification" {
    for_each = [50, 80, 100]
    content {
      enabled        = true
      threshold      = notification.value
      operator       = "GreaterThan"
      threshold_type = "Actual"
      contact_emails = var.alert_emails
    }
  }

  lifecycle {
    ignore_changes = [time_period]
  }
}

output "log_analytics_workspace_id" { value = azurerm_log_analytics_workspace.this.id }
output "log_analytics_customer_id" { value = azurerm_log_analytics_workspace.this.workspace_id }
output "app_insights_connection_string" {
  value     = azurerm_application_insights.this.connection_string
  sensitive = true
}
output "action_group_id" { value = azurerm_monitor_action_group.oncall.id }
