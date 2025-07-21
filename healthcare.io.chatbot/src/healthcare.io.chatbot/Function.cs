using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Amazon.Lambda.Core;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.Lambda.Annotations;
using Amazon.BedrockAgentRuntime;
using System.Text;
using Amazon.BedrockAgentRuntime.Model;

[assembly: LambdaSerializer(typeof(Amazon.Lambda.Serialization.SystemTextJson.DefaultLambdaJsonSerializer))]

namespace healthcare.io.chatbot
{
    public class Function
    {
        private readonly IAmazonBedrockAgentRuntime _amazonBedrockAgentRuntime;

        public Function(IAmazonBedrockAgentRuntime amazonBedrockAgentRuntime)
        {
            _amazonBedrockAgentRuntime = amazonBedrockAgentRuntime;
        }


        [LambdaFunction]
        public async Task<APIGatewayProxyResponse> FunctionHandler(APIGatewayProxyRequest request, ILambdaContext context)
        {
            try
            {

                var requestBody = System.Text.Json.JsonSerializer.Deserialize<ChatRequest>(request.Body);

                var sessionId = !string.IsNullOrEmpty(requestBody.SessionId) ? requestBody.SessionId : Guid.NewGuid().ToString();
                var message = requestBody.Message ?? string.Empty;

                var response = await _amazonBedrockAgentRuntime.InvokeAgentAsync(new InvokeAgentRequest
                {
                    AgentId = Environment.GetEnvironmentVariable("AGENT_ID"),
                    AgentAliasId = Environment.GetEnvironmentVariable("AGENT_ALIAS_ID"),
                    SessionId = sessionId,
                    InputText = message
                });

                var sb = new StringBuilder();

                // 透過 SSE 格式回應
                await foreach (var item in response.Completion)
                {
                    if (item is Amazon.BedrockAgentRuntime.Model.PayloadPart payloadPart)
                    {
                        var chunk = Encoding.UTF8.GetString(payloadPart.Bytes.ToArray());
                        sb.AppendLine(chunk);
                    }
                }

                return new APIGatewayProxyResponse
                {
                    StatusCode = 200,
                    Headers = new Dictionary<string, string>
                    {
                        { "Cache-Control", "no-cache" },
                        { "Connection", "keep-alive" },
                        { "Access-Control-Allow-Origin", "*" },
                        { "Access-Control-Allow-Headers", "Content-Type" }
                    },
                    Body = sb.ToString()
                };
            }
            catch (Exception ex)
            {
                return new APIGatewayProxyResponse
                {
                    StatusCode = 500,
                    Headers = new Dictionary<string, string>
                    {
                        { "Content-Type", "application/json" },
                        { "Access-Control-Allow-Origin", "*" }
                    },
                    Body = $"{{\"error\": \"Error invoking Bedrock Agent: {ex.Message}\"}}"
                };
            }
        }
    }
}
