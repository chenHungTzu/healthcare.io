
using Amazon.Lambda.Annotations;
using healthcare.io.DI;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace healthcare.io.transcribe_summary;

[LambdaStartup]
public class Startup
{
    public void ConfigureServices(IServiceCollection services)
    {
        IConfiguration configuration = new ConfigurationBuilder()
            .SetBasePath(Directory.GetCurrentDirectory())
            .Build();

        services.AddAWS(configuration);
    }
}