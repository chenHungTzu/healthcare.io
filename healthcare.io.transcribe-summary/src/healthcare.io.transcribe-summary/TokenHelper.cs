using System.Text;

namespace healthcare.io.transcribe_summary;

public static class TokenHelper
{
    private const int MAX_TOKENS = 8192;
    private const int AVERAGE_CHARS_PER_TOKEN = 4; // 英文大約4個字符=1個token，中文可能更少
    private const int SAFETY_MARGIN = 500; // 安全邊際，預留給prompt和配置
    
    /// <summary>
    /// 估算文字的 token 數量
    /// </summary>
    /// <param name="text">要估算的文字</param>
    /// <returns>估算的 token 數量</returns>
    public static int EstimateTokenCount(string text)
    {
        if (string.IsNullOrEmpty(text))
            return 0;
            
        // 簡單估算：字符數除以平均每token字符數
        return (int)Math.Ceiling((double)text.Length / AVERAGE_CHARS_PER_TOKEN);
    }
    
    /// <summary>
    /// 檢查文字是否超過 token 限制
    /// </summary>
    /// <param name="text">要檢查的文字</param>
    /// <param name="promptOverhead">prompt 額外佔用的 token 數（預設500）</param>
    /// <returns>是否超過限制</returns>
    public static bool ExceedsTokenLimit(string text, int promptOverhead = SAFETY_MARGIN)
    {
        var estimatedTokens = EstimateTokenCount(text);
        return estimatedTokens + promptOverhead > MAX_TOKENS;
    }
    
    /// <summary>
    /// 將長文字切分成多個符合 token 限制的片段
    /// </summary>
    /// <param name="text">要切分的文字</param>
    /// <param name="promptOverhead">prompt 額外佔用的 token 數</param>
    /// <returns>切分後的文字片段列表</returns>
    public static List<string> SplitTextByTokenLimit(string text, int promptOverhead = SAFETY_MARGIN)
    {
        var chunks = new List<string>();
        
        if (!ExceedsTokenLimit(text, promptOverhead))
        {
            chunks.Add(text);
            return chunks;
        }
        
        var maxCharsPerChunk = (MAX_TOKENS - promptOverhead) * AVERAGE_CHARS_PER_TOKEN;
        var lines = text.Split('\n', StringSplitOptions.RemoveEmptyEntries);
        var currentChunk = new StringBuilder();
        
        foreach (var line in lines)
        {
            // 如果加上這行會超過限制，先存儲當前chunk
            if (currentChunk.Length + line.Length + 1 > maxCharsPerChunk && currentChunk.Length > 0)
            {
                chunks.Add(currentChunk.ToString().Trim());
                currentChunk.Clear();
            }
            
            // 如果單行就超過限制，需要進一步切分
            if (line.Length > maxCharsPerChunk)
            {
                var subChunks = SplitLongLine(line, maxCharsPerChunk);
                foreach (var subChunk in subChunks)
                {
                    if (currentChunk.Length > 0)
                    {
                        chunks.Add(currentChunk.ToString().Trim());
                        currentChunk.Clear();
                    }
                    chunks.Add(subChunk);
                }
            }
            else
            {
                if (currentChunk.Length > 0)
                    currentChunk.AppendLine();
                currentChunk.Append(line);
            }
        }
        
        // 添加最後一個chunk
        if (currentChunk.Length > 0)
        {
            chunks.Add(currentChunk.ToString().Trim());
        }
        
        return chunks;
    }
    
    /// <summary>
    /// 切分過長的單行文字
    /// </summary>
    /// <param name="line">要切分的行</param>
    /// <param name="maxCharsPerChunk">每個片段的最大字符數</param>
    /// <returns>切分後的片段</returns>
    private static List<string> SplitLongLine(string line, int maxCharsPerChunk)
    {
        var chunks = new List<string>();
        var words = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var currentChunk = new StringBuilder();
        
        foreach (var word in words)
        {
            if (currentChunk.Length + word.Length + 1 > maxCharsPerChunk && currentChunk.Length > 0)
            {
                chunks.Add(currentChunk.ToString().Trim());
                currentChunk.Clear();
            }
            
            if (currentChunk.Length > 0)
                currentChunk.Append(" ");
            currentChunk.Append(word);
        }
        
        if (currentChunk.Length > 0)
        {
            chunks.Add(currentChunk.ToString().Trim());
        }
        
        return chunks;
    }
    
    /// <summary>
    /// 獲取適合的 chunk 大小建議
    /// </summary>
    /// <param name="totalTextLength">總文字長度</param>
    /// <param name="promptOverhead">prompt 開銷</param>
    /// <returns>建議的 chunk 數量</returns>
    public static int GetRecommendedChunkCount(string text, int promptOverhead = SAFETY_MARGIN)
    {
        var estimatedTokens = EstimateTokenCount(text);
        var availableTokens = MAX_TOKENS - promptOverhead;
        
        return (int)Math.Ceiling((double)estimatedTokens / availableTokens);
    }
}
