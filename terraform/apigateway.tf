resource "aws_apigatewayv2_api" "main" {
  name          = var.project
  protocol_type = "HTTP"
  tags          = { Project = var.project }
}

resource "aws_apigatewayv2_integration" "trigger" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.trigger.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "run" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /run"
  target    = "integrations/${aws_apigatewayv2_integration.trigger.id}"
}

resource "aws_apigatewayv2_route" "run_options" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "OPTIONS /run"
  target    = "integrations/${aws_apigatewayv2_integration.trigger.id}"
}

# Catches every other route (/init, /deploy/*, their OPTIONS preflights, etc.) so
# new endpoints don't need a new aws_apigatewayv2_route each time — the Lambda
# itself dispatches on method + path.
resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.trigger.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.trigger.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}
