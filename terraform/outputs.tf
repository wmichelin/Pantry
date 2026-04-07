output "project_id" {
  description = "Pantry DigitalOcean project ID"
  value       = digitalocean_project.pantry.id
}

output "droplet_ip" {
  description = "Pantry web droplet IP"
  value       = digitalocean_droplet.pantry_web.ipv4_address
}

output "url" {
  description = "Pantry URL"
  value       = "https://pantry.waltermichelin.com"
}
