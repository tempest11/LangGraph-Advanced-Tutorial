.. _cachegen:

# CacheGen

Cachegen leverages KV cache's distributional properties to encode a KV cache into more compact bitstream representations with negligible decoding overhead.

## Configuring CacheGen in LMCache

The settings should be very similar to :ref:`naive KV cache sharing <share_kv_cache>`. 
Only minor configurations need to be done to enable CacheGen. 

To enable CacheGen in offline inference, we need to set:

``python
 # Enable cachgen compression in LMCache
 os.environ["LMCACHE_REMOTE_SERDE"] = "cachegen"
``

To enable CacheGen in online inference, we need to set the `remote_serde` in the configuration yaml:

``yaml
 # Enable cachgen compression in LMCache
``
    remote_serde: "cachegen"