terraform {
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
  }
}

provider "digitalocean" {
  token = var.do_token
}

resource "digitalocean_project" "pantry" {
  name        = "Pantry"
  description = "Pantry app infrastructure"
  purpose     = "Web Application"
  environment = "Development"
}

resource "digitalocean_droplet" "pantry_web" {
  name     = "pantry-web"
  region   = "nyc3"
  size     = "s-1vcpu-1gb"
  image    = "ubuntu-24-04-x64"
  ssh_keys = [55438376]

  user_data = <<-EOF
    #!/bin/bash
    apt-get update -y
    apt-get install -y docker.io
    systemctl enable docker
    systemctl start docker
  EOF
}

resource "digitalocean_domain" "waltermichelin" {
  name = "waltermichelin.com"
}

resource "digitalocean_record" "pantry" {
  domain = digitalocean_domain.waltermichelin.name
  type   = "A"
  name   = "pantry"
  value  = digitalocean_droplet.pantry_web.ipv4_address
  ttl    = 300
}

resource "digitalocean_project_resources" "pantry" {
  project   = digitalocean_project.pantry.id
  resources = [digitalocean_droplet.pantry_web.urn]
}
