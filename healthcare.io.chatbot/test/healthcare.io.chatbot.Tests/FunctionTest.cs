using Xunit;
using Amazon.Lambda.TestUtilities;
using Amazon.Lambda.APIGatewayEvents;
using System.Threading.Tasks;

namespace healthcare.io.chatbot.Tests
{
    public class FunctionTest
    {
        [Fact]
        public async Task TestFunctionHandler()
        {
            // var function = new Function();
            // var request = new APIGatewayProxyRequest();
            // var context = new TestLambdaContext();

            // var response = await function.FunctionHandler(request, context);

            // Assert.Equal(200, response.StatusCode);
            // Assert.Equal("Hello from healthcare.io.chatbot!", response.Body);
        }
    }
}
