# Fill in from `terraform -chdir=infra/terraform/bootstrap output` (run once by an administrator).
resource_group_name  = "rg-qarib-tfstate"
storage_account_name = "<bootstrap storage_account_name>"
container_name       = "tfstate"
key                  = "qarib-dev.tfstate"
use_azuread_auth     = true
