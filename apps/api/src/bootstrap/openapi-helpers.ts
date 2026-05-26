import type { OpenAPIV3 } from 'openapi-types'

export function errorResponse(): OpenAPIV3.ResponseObject {
  return jsonResponse('ApiError')
}

export function emptyResponse(description: string): OpenAPIV3.ResponseObject {
  return {
    description,
  }
}

export function jsonRequestBody(
  schemaName: string,
): OpenAPIV3.RequestBodyObject {
  return {
    content: {
      'application/json': {
        schema: {
          $ref: `#/components/schemas/${schemaName}`,
        },
      },
    },
    required: true,
  }
}

export function jsonResponse(schemaName: string): OpenAPIV3.ResponseObject {
  return {
    content: {
      'application/json': {
        schema: {
          $ref: `#/components/schemas/${schemaName}`,
        },
      },
    },
    description: `${schemaName} response.`,
  }
}

export function nullableStringSchema(): OpenAPIV3.SchemaObject {
  return {
    nullable: true,
    type: 'string',
  }
}

export function nullableRefSchema(schemaName: string): OpenAPIV3.SchemaObject {
  return {
    allOf: [
      {
        $ref: `#/components/schemas/${schemaName}`,
      },
    ],
    nullable: true,
  }
}

export function genericJsonObjectSchema(): OpenAPIV3.SchemaObject {
  return {
    additionalProperties: true,
    type: 'object',
  }
}

export function genericJsonArraySchema(
  itemSchemaName: string,
): OpenAPIV3.SchemaObject {
  return {
    items: {
      $ref: `#/components/schemas/${itemSchemaName}`,
    },
    type: 'array',
  }
}

export function parameter(name: string): OpenAPIV3.ReferenceObject {
  return {
    $ref: `#/components/parameters/${name}`,
  }
}

export function positiveIntegerSchema(): OpenAPIV3.SchemaObject {
  return {
    minimum: 1,
    type: 'integer',
  }
}

export function emojiSetIdParameter(): OpenAPIV3.ParameterObject {
  return {
    in: 'path',
    name: 'emojiSetId',
    required: true,
    schema: {
      type: 'string',
    },
  }
}

export function iconAssetIdParameter(): OpenAPIV3.ParameterObject {
  return {
    in: 'path',
    name: 'iconAssetId',
    required: true,
    schema: {
      type: 'string',
    },
  }
}

export function idPathParameter(name: string): OpenAPIV3.ParameterObject {
  return {
    in: 'path',
    name,
    required: true,
    schema: {
      type: 'string',
    },
  }
}

export function datePathParameter(): OpenAPIV3.ParameterObject {
  return idPathParameter('date')
}

export function fileNameParameter(): OpenAPIV3.ParameterObject {
  return {
    in: 'path',
    name: 'fileName',
    required: true,
    schema: {
      maxLength: 260,
      pattern: '^[a-z0-9][a-z0-9._-]*$',
      type: 'string',
    },
  }
}

export function habitIdParameter(): OpenAPIV3.ParameterObject {
  return idPathParameter('habitId')
}

export function installationIdParameter(): OpenAPIV3.ParameterObject {
  return idPathParameter('installationId')
}

export function sphereIdParameter(): OpenAPIV3.ParameterObject {
  return idPathParameter('sphereId')
}

export function taskIdParameter(): OpenAPIV3.ParameterObject {
  return {
    in: 'path',
    name: 'taskId',
    required: true,
    schema: {
      type: 'string',
    },
  }
}

export function zoneIdParameter(): OpenAPIV3.ParameterObject {
  return idPathParameter('zoneId')
}

export function requiredStringQueryParameter(
  name: string,
): OpenAPIV3.ParameterObject {
  return {
    in: 'query',
    name,
    required: true,
    schema: {
      minLength: 1,
      type: 'string',
    },
  }
}

export function optionalStringQueryParameter(
  name: string,
): OpenAPIV3.ParameterObject {
  return {
    in: 'query',
    name,
    required: false,
    schema: {
      type: 'string',
    },
  }
}

export function optionalIntegerQueryParameter(
  name: string,
  minimum: number,
  maximum?: number,
): OpenAPIV3.ParameterObject {
  return {
    in: 'query',
    name,
    required: false,
    schema: {
      ...(maximum !== undefined ? { maximum } : {}),
      minimum,
      type: 'integer',
    },
  }
}

export function taskTemplateIdParameter(): OpenAPIV3.ParameterObject {
  return {
    in: 'path',
    name: 'templateId',
    required: true,
    schema: {
      type: 'string',
    },
  }
}

export function membershipIdParameter(): OpenAPIV3.ParameterObject {
  return {
    in: 'path',
    name: 'membershipId',
    required: true,
    schema: {
      type: 'string',
    },
  }
}

export function invitationIdParameter(): OpenAPIV3.ParameterObject {
  return {
    in: 'path',
    name: 'invitationId',
    required: true,
    schema: {
      type: 'string',
    },
  }
}

export function userIdParameter(): OpenAPIV3.ParameterObject {
  return {
    in: 'path',
    name: 'userId',
    required: true,
    schema: {
      type: 'string',
    },
  }
}
