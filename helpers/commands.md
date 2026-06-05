# Disparar scrape de preços
$body = @{
    requestId     = "af83b152-12e7-4127-a917-acb384efffdf"
    routineId     = "7c0b00e3-a4c3-48b6-9b03-7299b4dd7154"
    airline       = "ryanair"
    origin        = "LIS"
    destination   = "LON"
    outboundStart = "2026-07-13"
    outboundEnd   = "2026-07-13"
    passengers    = 1
} | ConvertTo-Json

Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/scrape" `
  -Headers @{ "X-API-Key" = "local-test-key" } `
  -ContentType "application/json" `
  -Body $body

# Disparar busca de cobertura por airline
$body = @{
    airline = "ryanair"
} | ConvertTo-Json

Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/coverage" `
  -Headers @{ "X-API-Key" = "local-test-key" } `
  -ContentType "application/json" `
  -Body $body