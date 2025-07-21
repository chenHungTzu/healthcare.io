using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace healthcare.io.chatbot
{
    public class ChatRequest
    {
        public string? SessionId { get; set; }
        public string? Message { get; set; }
    }
}