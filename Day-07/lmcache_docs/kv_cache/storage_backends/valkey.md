# Valkey

## Overview

Valkey is an open source (BSD) high-performance key/value datastore and is a supported option for remote KV Cache offloading in LMCache.
Some other remote backends are [Mooncake ](./mooncake.md), [Redis ](./redis.md), and [InfiniStore ](./infinistore.md).

## Prerequisites

To use this connector, you need valkey-glide 2.0 or higher. Valkey Connector currently uses pipelining, which generally results in better RTT compared to Redis Connector.
Pipelining will also be implemented to the Redis Connector in the future.

``shell
 # Install Valkey-GLIDE (Minimum 2.0.0 or higher)
 $ pip install valkey-glide
``

## Example Configurations

### Basic Valkey Configuration (Standalone mode)

``yaml
chunk_size: 256
remote_url: "valkey://<your host>:6379"
remote_serde: "naive"
extra_config:
  valkey_username: "Your username"
  valkey_password: "Your password"
``

### Standalone-mode Valkey Configuration with database

``yaml
chunk_size: 256
remote_url: "valkey://<your host>:6379"
remote_serde: "naive"
extra_config:
  valkey_username: "Your username"
  valkey_password: "Your password"
  valkey_database: 0
``

### Cluster-mode Valkey Configuration (Endpoint)

``yaml
chunk_size: 256
remote_url: "valkey://<your host>:6379"
remote_serde: "naive"
extra_config:
  valkey_mode: "cluster"
  valkey_username: "Your username"
  valkey_password: "Your password"
``

### Cluster-mode Valkey Configuration (Nodes)

``yaml
chunk_size: 256
remote_url: "valkey://<your host 1>:<your port 1>, <your host 2>:<your port 2>, ... <your host N>:<your port N>"
remote_serde: "naive"
extra_config:
  valkey_mode: "cluster"
  valkey_username: "Your username"
  valkey_password: "Your password"
``
