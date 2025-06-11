using Amazon.Bedrock;
using Amazon.BedrockRuntime;
using Amazon.S3;
using Amazon.TranscribeService;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace healthcare.io.DI;

public static class AwsServiceRegistration
{
    public static IServiceCollection AddAWS(this IServiceCollection services,
        IConfiguration configuration)
    {

        #region S3

        services.AddSingleton<IAmazonS3>(_ =>
                  {
                      var clientConfig = new AmazonS3Config
                      {
                          RegionEndpoint = Amazon.RegionEndpoint.APNortheast1
                      };

                      return new AmazonS3Client(clientConfig);
                  });
        #endregion

        #region Transcribe


        services.AddSingleton<IAmazonTranscribeService>(_ =>
        {

            return new AmazonTranscribeServiceClient(Amazon.RegionEndpoint.APNortheast1);
        });

        #endregion

        #region Bedrock

        services.AddSingleton<IAmazonBedrockRuntime>(_ =>
        {
            return new AmazonBedrockRuntimeClient(Amazon.RegionEndpoint.APNortheast1);
        });
        #endregion

        return services;
    }
}